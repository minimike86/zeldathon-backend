import {inject} from '@loopback/core';
import {
    Request,
    RestBindings,
    get,
    post,
    requestBody,
    param
} from '@loopback/rest';

const puppeteer = require('puppeteer');
// @ts-ignore
import {Browser, ElementHandle, Page, SetCookie} from 'puppeteer';
const imageDataURI = require('image-data-uri');


export class HowLongToBeatController {
    private BASE_URL: string = `https://howlongtobeat.com`;

    public browser: Browser;
    public page: Page;

    public totalResults: number = 0;
    public searchResults: HowLongToBeatSearchResult[] = [];

    constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
    }

    @post('/howlongtobeat/search/{queryString}')
    postSearch(
        @param.path.string('queryString', {
            description: 'queryString'
        }) queryString: string,
    ): object {
        return (async () => {
            await this.launchBrowser();

            // load search_results
            await this.page.goto(this.BASE_URL, {waitUntil: 'networkidle2'});
            await this.acceptCookieWarning();

            // Search for the game and return first 20 results
            await this.searchForGame(`${queryString}`);
            await this.page.waitForXPath('//*[@id="global_search_content"]/*[2]/*[@class="back_darkish"]').then(async () => {
                this.totalResults = await this.getTotalResults();
                this.searchResults = await this.parsePageResults(`${queryString}`);
            });

            await this.browser.close();
            return this.searchResults;
        })();
    }

    @get('/howlongtobeat/detail/{gameId}')
    getDetail(
        @param.query.string('gameId', {
            description: 'gameId'
        }) gameId: string,
    ): object {
        return (async () => {
            await this.launchBrowser();

            // load game details page
            await this.page.goto(`${this.BASE_URL}/game?id=${gameId}`, {waitUntil: 'networkidle2'});
            await this.acceptCookieWarning();

            // Scrape page and return result
            let howLongToBeatGameDetail: HowLongToBeatGameDetail = {
                id: null,
                title: null,
                boxArt: null,
                titleGameTimes: [],
                detail: {
                    description1: null,
                    description2: null,
                    platforms: null,
                    genres: null,
                    developer: null,
                    publisher: null,
                    releases: {
                        NA: null,
                        EU: null,
                        JP: null,
                    },
                    updated: null
                },
                additionalContent: [],
                gameTimes: null,
                speedRunTimes: null,
                platformTimes: null
            };

            // title
            await this.page.waitForXPath('//*[@class="profile_header shadow_text"]').then(() => {
                return (async () => {
                    const [titleElemHandle] = await this.page.$x('//*[@class="profile_header shadow_text"]');
                    const _title: string = await this.page.evaluate(el => el.textContent, titleElemHandle);
                    howLongToBeatGameDetail.title = HowLongToBeatController.replaceAll(_title);
                })();
            });

            // title game times
            await this.page.waitForXPath('//*[@class="game_times"]/ul/li').then(() => {
                return (async () => {
                    const titleGameTimesElemHandle = await this.page.$x('//*[@class="game_times"]/ul/li');
                    for (let i = 0; i < titleGameTimesElemHandle.length; i++) {
                        const [labelElementHandle]: ElementHandle[] = await titleGameTimesElemHandle[i].$x('.//h5');
                        const _label: string = await this.page.evaluate(el => el.textContent, labelElementHandle);
                        const [timeElementHandle]: ElementHandle[] = await titleGameTimesElemHandle[i].$x('.//div');
                        const _time: string = await this.page.evaluate(el => el.textContent, timeElementHandle);
                        const gameTime: TimeLabel = {
                            label: _label,
                            time: _time?.trim()
                        };
                        howLongToBeatGameDetail.titleGameTimes.push(gameTime);
                    }
                })();
            });

            // detail
            await this.page.waitForXPath('//*[@class="in back_primary shadow_box"]').then(() => {
                return (async () => {
                    const [readMoreElemHandle] = await this.page.$x('//*[@id="profile_summary_more"]');
                    await readMoreElemHandle?.click({delay: 10});
                    const [detailElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]');
                    howLongToBeatGameDetail.detail = await this.page.evaluate(el => el.textContent, detailElemHandle);
                })();
            });

            // additional content
            await this.page.waitForXPath('//*[@class="in scrollable back_primary shadow_box"]/table').then(() => {
                return (async () => {
                    const additionalContentTableElemHandle = await this.page.$x('//*[@class="in scrollable back_primary shadow_box"]/table');
                    for (let i = 0; i < additionalContentTableElemHandle.length; i++) {
                        const additionalContentRowElemHandle = await additionalContentTableElemHandle[i].$x('.//tbody/tr');
                        for (let j = 0; j < additionalContentRowElemHandle.length; j++) {
                            const _additionalContent: HowLongToBeatGameAdditionalContent = {
                                id: '',
                                title: '',
                                polled: '',
                                rated: '',
                                main: '',
                                mainPlus: '',
                                hundredPercent: '',
                                all: ''
                            };
                            const additionalContentCellElemHandle = await additionalContentRowElemHandle[j].$x('.//td');
                            const _id: string = await this.page.evaluate(el => el.children[0]?.href, additionalContentCellElemHandle[0]);
                            _additionalContent.id = HowLongToBeatController.replaceAll(_id).match(/\d+/g)![0];
                            _additionalContent.title = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[0]));
                            _additionalContent.polled = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[1]));
                            _additionalContent.rated = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[2]));
                            _additionalContent.main = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[3]));
                            _additionalContent.mainPlus = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[4]));
                            _additionalContent.hundredPercent = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[5]));
                            _additionalContent.all = HowLongToBeatController.replaceAll(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[6]));
                            howLongToBeatGameDetail.additionalContent.push(_additionalContent);
                        }
                    }
                })();
            });

            // game times
            await this.page.waitForXPath('//table[@class="game_main_table"]').then(() => {
                return (async () => {
                    const [gameTimesTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Single-Player")]/../../..');
                    if (gameTimesTableExists) {
                        const _gameTimes: string = await this.page.evaluate(el => el.outerHTML, gameTimesTableExists);
                        howLongToBeatGameDetail.gameTimes = HowLongToBeatController.replaceAll(_gameTimes);
                    }
                    const [speedrunTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Speedrun")]/../../..');
                    if (speedrunTableExists) {
                        const _speedRunTimes: string = await this.page.evaluate(el => el.outerHTML, speedrunTableExists);
                        howLongToBeatGameDetail.speedRunTimes = HowLongToBeatController.replaceAll(_speedRunTimes);
                    }
                    const [platformTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Platform")]/../../..');
                    if (platformTableExists) {
                        const _platformTimes: string = await this.page.evaluate(el => el.outerHTML, platformTableExists);
                        howLongToBeatGameDetail.platformTimes = HowLongToBeatController.replaceAll(_platformTimes);
                    }
                })();
            });

            await this.browser.close();
            return howLongToBeatGameDetail;
        })();
    }

    private static replaceAll(str: string): string {
        return str.replace(/\n/g, '').replace(/\t/g, '');
    }

    private async launchBrowser() {
        this.browser = await puppeteer.launch({headless: false});
        const context = this.browser.defaultBrowserContext();
        await context.overridePermissions("https://howlongtobeat.com/", []);
        this.page = await this.browser.newPage();
        await this.page.setDefaultNavigationTimeout(100000);
        await this.page.setViewport({
            width: 1920,
            height: 920,
            deviceScaleFactor: 1
        });
    }

    private async acceptCookieWarning(): Promise<void> {
        // Accept cookie warning banner
        await this.page.waitForXPath('//*[@id="_evidon-banner-acceptbutton"]').then(() => {
            return (async () => {
                const [acceptCookiesButton] = await this.page.$x('//*[@id="_evidon-banner-acceptbutton"]');
                await acceptCookiesButton?.click({ delay: 10 });
            })();
        });
    }

    private async searchForGame(queryString: string): Promise<void> {
        // Accept cookie warning banner
        await this.page.waitForXPath('//*[@id="global_search_box"]').then(() => {
            return (async () => {
                const [searchInput] = await this.page.$x('//*[@id="global_search_box"]');
                await searchInput.type(`${queryString}`, { delay: 10 });
            })();
        });
    }

    private async parsePageResults(searchTerm: string): Promise<HowLongToBeatSearchResult[]> {
        const results: HowLongToBeatSearchResult[] = [];
        const elementHandles: ElementHandle<Element>[] = await this.page.$x('//*[@id="global_search_content"]/*[2]/*[@class="back_darkish"]');
        for (let i = 0; i < elementHandles.length; i++) {

            const [idElemHandle]: ElementHandle[] = await elementHandles[i].$x('.//h3/a');
            const _id = await this.page.evaluate(el => el?.getAttribute('href'), idElemHandle);

            const [titleElemHandle]: ElementHandle[] = await elementHandles[i].$x('.//h3/a');
            const _title = await this.page.evaluate(el => el?.textContent, titleElemHandle);

            const [boxArtElemHandle]: ElementHandle[] = await elementHandles[i].$x('.//img');
            const _boxArt = await this.page.evaluate(el => el?.getAttribute('src'), boxArtElemHandle);

            const timeLabelsElemHandle: ElementHandle[] = await elementHandles[i].$x('.//*[@class="search_list_tidbit text_white shadow_text"]');
            const _timeLabels: string[] = [];
            for (let j = 0; j < timeLabelsElemHandle.length; j++) {
                const timeLabel = await this.page.evaluate(el => el?.textContent, timeLabelsElemHandle[j]);
                _timeLabels.push(timeLabel);
            }

            const gameplayMainElemHandle: ElementHandle[] = await elementHandles[i].$x('.//div[contains(@class, "search_list_tidbit") and contains(@class, "time")][1]');
            const _gameplayMain: string = await this.page.evaluate(el => el?.textContent, gameplayMainElemHandle[0]);

            const gameplayMainExtraElemHandle: ElementHandle[] = await elementHandles[i].$x('.//div[contains(@class, "search_list_tidbit") and contains(@class, "time")][2]');
            const _gameplayMainExtra: string = await this.page.evaluate(el => el?.textContent, gameplayMainExtraElemHandle[0]);

            const gameplayMainCompletionistElemHandle: ElementHandle[] = await elementHandles[i].$x('.//div[contains(@class, "search_list_tidbit") and contains(@class, "time")][3]');
            const _gameplayMainCompletionist: string = await this.page.evaluate(el => el?.textContent, gameplayMainCompletionistElemHandle[0]);

            let howLongToBeatSearchResult: HowLongToBeatSearchResult = {
                id: _id.match(/\d+/g)[0],
                title: _title,
                boxArt: this.BASE_URL + _boxArt,
                timeLabels: _timeLabels,
                gameplayMain: _gameplayMain?.trim(),
                gameplayMainExtra: _gameplayMainExtra?.trim(),
                gameplayCompletionist: _gameplayMainCompletionist?.trim(),
                similarity: HowLongToBeatController.getLevenshteinDistance(searchTerm, _title),
                searchTerm: searchTerm,
            }

            results.push(howLongToBeatSearchResult);

        }
        return new Promise<HowLongToBeatSearchResult[]>(resolve => {
            resolve(results);
        });
    }

    private static getLevenshteinDistance(s: string, t: string): number {
        if (!s.length) return t.length;
        if (!t.length) return s.length;
        const arr = [];
        for (let i = 0; i <= t.length; i++) {
            arr[i] = [i];
            for (let j = 1; j <= s.length; j++) {
                arr[i][j] =
                    i === 0
                        ? j
                        : Math.min(
                            arr[i - 1][j] + 1,
                            arr[i][j - 1] + 1,
                            arr[i - 1][j - 1] + (s[j - 1] === t[i - 1] ? 0 : 1)
                        );
            }
        }
        return arr[t.length][s.length];
    }

    private async getTotalResults(): Promise<number> {
        let totalResults: number = 0;
        return await this.page.waitForXPath('//*[@id="global_search_content"]/div[1]/h3').then(async () => {
            const [selectorElems]: ElementHandle<Element>[] = await this.page.$x('//*[@id="global_search_content"]/div[1]/h3');
            const evaluateStr: string = await this.page.evaluate(el => el?.textContent, selectorElems);
            const matches = evaluateStr.match(/[\d]+/g);
            if (matches !== null) {
                totalResults = parseInt(matches[0]);
            }
            return totalResults;
        });
    }
}

export interface HowLongToBeatSearchResult {
    id: string;
    title: string;
    boxArt: string;
    timeLabels: string[],
    gameplayMain: string,
    gameplayMainExtra: string,
    gameplayCompletionist: string,
    similarity: number,
    searchTerm: string
}

export interface HowLongToBeatGameDetail {
    id: string|null;
    title: string|null;
    boxArt: string|null;
    titleGameTimes: TimeLabel[];
    detail: HowLongToBeatGameDetailInfo;
    additionalContent: HowLongToBeatGameAdditionalContent[];
    gameTimes: string|null;
    speedRunTimes: string|null;
    platformTimes: string|null;
}

export interface HowLongToBeatGameAdditionalContent {
    id: string|null;
    title: string|null;
    polled: string|number|null;
    rated: string|number|null;
    main: string|null;
    mainPlus: string|null;
    hundredPercent: string|null;
    all: string|null;
}

export interface TimeLabel {
    label: string,
    time: string
}

export interface HowLongToBeatGameDetailInfo {
    description1: string|null;
    description2: string|null;
    platforms: string|null;
    genres: string|null;
    developer: string|null;
    publisher: string|null;
    releases: {
        NA: string|null;
        EU: string|null;
        JP: string|null;
    }
    updated: string|null;
}