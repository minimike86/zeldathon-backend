import {inject} from '@loopback/core';
import {
    Request,
    RestBindings,
    get,
    param
} from '@loopback/rest';

const puppeteer = require('puppeteer');
import {Browser, ElementHandle, Page} from 'puppeteer';
const imageDataURI = require('image-data-uri');


export class HowLongToBeatController {
    private BASE_URL: string = `https://howlongtobeat.com`;

    public browser: Browser;
    public page: Page;

    public totalResults: number = 0;
    public searchResults: HowLongToBeatSearchResult[] = [];

    constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
    }

    @get('/howlongtobeat/search/{queryString}')
    getSearch(
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
                this.searchResults.push(...await this.parsePageResults(`${queryString}`));

                const pageElemHandlers: ElementHandle[] = await this.page.$x('//h2/strong[contains(text(),"Page")]/../span');
                for (let i = 1; i < pageElemHandlers.length; i++) {

                    console.log(`clicking button: array[${i}], actual [${await this.page.evaluate(el => el.textContent, pageElemHandlers[i])}]`);
                    await this.page.evaluate(elem => (elem as HTMLElement).click(), pageElemHandlers[i]);
                    await this.page.waitForTimeout(400);

                    this.searchResults.push(...await this.parsePageResults(`${queryString}`));
                }

            });

            await this.browser.close();
            console.log('searchResults: ', this.searchResults.length);
            return this.searchResults;
        })();
    }

    @get('/howlongtobeat/detail/{gameId}')
    getDetail(
        @param.path.string('gameId', {
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
                id: gameId,
                title: null,
                boxArt: null,
                titleGameTimes: [],
                detail: {
                    description1: null,
                    description2: null,
                    platforms: [],
                    genres: [],
                    developer: [],
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
                    howLongToBeatGameDetail.title = HowLongToBeatController.replaceAllTabsNewLines(_title);
                })();
            });

            // boxArt
            await this.page.waitForXPath('//div[contains(@class, "game_image")]/img').then(() => {
                return (async () => {
                    const [boxArtElemHandle] = await this.page.$x('//div[contains(@class, "game_image")]/img');
                    const _boxArt: string = await this.page.evaluate(el => el.src, boxArtElemHandle);
                    howLongToBeatGameDetail.boxArt = HowLongToBeatController.replaceAllTabsNewLines(_boxArt);
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

                    const detailElemHandle = await this.page.$x('//div[contains(@class, "profile_info")]');
                    const description1Str: string = await this.page.evaluate(el => el.textContent, detailElemHandle[0]);
                    howLongToBeatGameDetail.detail.description1 = HowLongToBeatController.replaceAllTabsNewLines(description1Str);

                    try {
                        const description2Str: string = await this.page.evaluate(el => el.textContent, detailElemHandle[1]);
                        howLongToBeatGameDetail.detail.description2 = HowLongToBeatController.replaceAllTabsNewLines(description2Str);
                    } catch (err) {
                        howLongToBeatGameDetail.detail.description2 = null;
                    }

                    const [platformElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "Platform:") or contains(text(), "Platforms:")]/..');
                    const platformStr: string = await this.page.evaluate(el => el.textContent, platformElemHandle);
                    howLongToBeatGameDetail.detail.platforms = HowLongToBeatController.replaceAllTabsNewLines(platformStr)
                                                                                      .replace(/Platform[s]{0,1}:/g, '')
                                                                                      .split(',')
                                                                                      .map(platform => platform.trim());

                    try {
                        const [genreElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "Genre:") or contains(text(), "Genres:")]/..');
                        const genreStr: string = await this.page.evaluate(el => el.textContent, genreElemHandle);
                        howLongToBeatGameDetail.detail.genres = HowLongToBeatController.replaceAllTabsNewLines(genreStr)
                                                                                       .replace(/Genre[s]{0,1}:/g, '')
                                                                                       .split(',')
                                                                                       .map(genre => genre.trim());
                    } catch (err) {
                        howLongToBeatGameDetail.detail.genres = null;
                    }

                    try {
                        const [developerElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "Developer:") or contains(text(), "Developers:")]/..');
                        const developerStr: string = await this.page.evaluate(el => el.textContent, developerElemHandle);
                        howLongToBeatGameDetail.detail.developer = HowLongToBeatController.replaceAllTabsNewLines(developerStr)
                                                                                          .replace(/Developer[s]{0,1}:/g, '')
                                                                                          .split(',')
                                                                                          .map(developer => developer.trim());
                    } catch (err) {
                        howLongToBeatGameDetail.detail.releases.NA = null;
                    }

                    const [publisherElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "Publisher:") or contains(text(), "Publishers:")]/..');
                    const publisherStr: string = await this.page.evaluate(el => el.textContent, publisherElemHandle);
                    howLongToBeatGameDetail.detail.publisher = HowLongToBeatController.replaceAllTabsNewLines(publisherStr)
                                                                                      .replace(/Publisher[s]{0,1}:/g, '');

                    try {
                        const [naElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "NA:")]/..');
                        const naStr: string = await this.page.evaluate(el => el.textContent, naElemHandle);
                        howLongToBeatGameDetail.detail.releases.NA = HowLongToBeatController.replaceAllTabsNewLines(naStr)
                                                                                            .replace(/NA:/g, '');
                    } catch (err) {
                        howLongToBeatGameDetail.detail.releases.NA = null;
                    }

                    try {
                        const [euElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "EU:")]/..');
                        const euStr: string = await this.page.evaluate(el => el.textContent, euElemHandle);
                        howLongToBeatGameDetail.detail.releases.EU = HowLongToBeatController.replaceAllTabsNewLines(euStr)
                                                                                            .replace(/EU:/g, '');
                    } catch (err) {
                        howLongToBeatGameDetail.detail.releases.EU = null;
                    }

                    try {
                        const [jpElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "JP:")]/..');
                        const jpStr: string = await this.page.evaluate(el => el.textContent, jpElemHandle);
                        howLongToBeatGameDetail.detail.releases.JP = HowLongToBeatController.replaceAllTabsNewLines(jpStr)
                                                                                            .replace(/JP:/g, '');
                    } catch (err) {
                        howLongToBeatGameDetail.detail.releases.JP = null;
                    }

                    const [updatedElemHandle] = await this.page.$x('//div[contains(@class, "profile_info")]/.//*[contains(text(), "Updated:")]/..');
                    const updatedStr: string = await this.page.evaluate(el => el.textContent, updatedElemHandle);
                    howLongToBeatGameDetail.detail.updated = HowLongToBeatController.replaceAllTabsNewLines(updatedStr)
                                                                                    .replace(/Updated:/g, '');
                })();
            });

            // additional content
            try {
                await this.page.waitForXPath('//*[@class="in scrollable back_primary shadow_box"]/table', {timeout: 100}).then(() => {
                    return (async () => {
                        const additionalContentTableElemHandle = await this.page.$x('//*[@class="in scrollable back_primary shadow_box"]/table');
                        if (additionalContentTableElemHandle.length >= 1) {
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
                                    _additionalContent.id = HowLongToBeatController.replaceAllTabsNewLines(_id).match(/\d+/g)![0];
                                    _additionalContent.title = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[0]));
                                    _additionalContent.polled = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[1]));
                                    _additionalContent.rated = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[2]));
                                    _additionalContent.main = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[3]));
                                    _additionalContent.mainPlus = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[4]));
                                    _additionalContent.hundredPercent = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[5]));
                                    _additionalContent.all = HowLongToBeatController.replaceAllTabsNewLines(await this.page.evaluate(el => el.textContent, additionalContentCellElemHandle[6]));
                                    howLongToBeatGameDetail.additionalContent.push(_additionalContent);
                                }
                            }
                        }
                    })();
                });
            } catch (err) {
                console.log('Game has no additional content. ', err);
            }

            // game times
            await this.page.waitForXPath('//table[@class="game_main_table"]').then(() => {
                return (async () => {
                    const [gameTimesTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Single-Player")]/../../..');
                    if (gameTimesTableExists) {
                        const _gameTimes: string = await this.page.evaluate(el => el.outerHTML, gameTimesTableExists);
                        howLongToBeatGameDetail.gameTimes = HowLongToBeatController.replaceAllTabsNewLines(_gameTimes);
                    }
                    const [speedrunTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Speedrun")]/../../..');
                    if (speedrunTableExists) {
                        const _speedRunTimes: string = await this.page.evaluate(el => el.outerHTML, speedrunTableExists);
                        howLongToBeatGameDetail.speedRunTimes = HowLongToBeatController.replaceAllTabsNewLines(_speedRunTimes);
                    }
                    const [platformTableExists] = await this.page.$x('//table[@class="game_main_table"]/thead/tr/td[contains(text(),"Platform")]/../../..');
                    if (platformTableExists) {
                        const _platformTimes: string = await this.page.evaluate(el => el.outerHTML, platformTableExists);
                        howLongToBeatGameDetail.platformTimes = HowLongToBeatController.replaceAllTabsNewLines(_platformTimes);
                    }
                })();
            });

            await this.browser.close();
            return howLongToBeatGameDetail;
        })();
    }

    private static replaceAllTabsNewLines(str: string): string {
        return str.replace(/\n/g, '').replace(/\t/g, '');
    }

    private async launchBrowser() {
        this.browser = await puppeteer.launch({headless: true});
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
    timeLabels: string[];
    gameplayMain: string;
    gameplayMainExtra: string;
    gameplayCompletionist: string;
    similarity: number;
    searchTerm: string;
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
    label: string;
    time: string;
}

export interface HowLongToBeatGameDetailInfo {
    description1: string|null;
    description2: string|null;
    platforms: string[]|null;
    genres: string[]|null;
    developer: string[]|null;
    publisher: string|null;
    releases: {
        NA: string|null;
        EU: string|null;
        JP: string|null;
    };
    updated: string|null;
}