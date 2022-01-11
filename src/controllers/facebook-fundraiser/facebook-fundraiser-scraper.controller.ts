import {inject} from '@loopback/core';
import {
  Request,
  RestBindings,
  get,
  post,
  param
} from '@loopback/rest';

const puppeteer = require('puppeteer');
// @ts-ignore
import {BoundingBox, Browser, ElementHandle, Page, SetCookie} from 'puppeteer';

const imageDataURI = require('image-data-uri');

import * as fs from 'fs';
import config from './facebook-config.json';
import cookiesJson from './facebook-cookies.json';


/**
 * A simple controller to scrape facebook data from fundraising page
 */
export class FacebookFundraiserController {

  public browser: Browser;
  public page: Page;

  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
  }

  @get('/facebook/fundraiser/{facebookFundraiserId}')
  scrapeFacebookFundraiser(
    @param.path.number('facebookFundraiserId', {
      description: 'Unique Facebook Fundraiser Id',
      content: { ['number']: {
          example: 855003971855785
        }}
    }) facebookFundraiserId: number,
  ): object {
    return (async () => {
      try {

        await this.launchBrowser();
        await this.loginIfRequired();

        // load donation page
        await this.page.goto(`https://www.facebook.com/donate/${facebookFundraiserId}/`, {waitUntil: 'networkidle2'});

        // get progress_card
        const progressCard = await this.getProgressCard();

        // get uniqueDonorCount
        const uniqueDonorCount: number = await this.getUniqueDonorCount();

        // render all the lazy loaded content in the page from infinite scroll
        let previousHeight;
        while (true) {
          try {
            previousHeight = await this.page.evaluate('document.body.scrollHeight');
            await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await this.page.waitForFunction(`document.body.scrollHeight > ${previousHeight}`);
          } catch (e) {
            console.log('Scrolled to end of donation feed');
            break;
          }
        }

        // get each donation
        const facebookDonations: FacebookDonation[] = [];

        await this.page.waitForXPath('//div[@role=\'feed\']/div[position()>2]', {timeout: 2000});
        const facebookDonationElems: ElementHandle[] = await this.page.$x('//div[@role=\'feed\']/div[position()>2]');
        console.log(`Grabbing ${facebookDonationElems.length} donations:`);
        for (let i = 0; i < facebookDonationElems.length; i++) {
          await facebookDonationElems[i].click(); // scroll to element

          // Capture name and amount div
          const nameAmount = await this.captureNameAmount(facebookDonationElems, i);
          const name: string = nameAmount.trim().slice(0, -1).split('donated £')[0];
          const currency: string = 'GBP';
          const amount: number = parseFloat(nameAmount.trim().slice(0, -1).split('donated £')[1]);
          console.log('nameAmount:', nameAmount, name, amount);

          // Capture the profile url
          const profileUrl: string = await this.captureProfileUrl(facebookDonationElems, i);
          console.log('profileUrl:', profileUrl);

          // Capture the imgSrc url
          const imgDataUri: string = await this.captureImgDataUri(facebookDonationElems, i);
          // console.log('imgDataUri:', imgDataUri);

          // Capture date div (from tooltip as greater detail includes time)
          const exactDateTime: Date = await this.captureExactDateTime(facebookDonationElems, i);
          console.log('exactDateTime:', exactDateTime);

          // Capture the donation url / id
          // const donationId: number = await this.captureDonationId(facebookDonationElems, i);
          // console.log('donationId:', donationId);

          // capture message
          const donationMessage: string = await this.captureDonationMessage(i);
          console.log('donationMessage:', donationMessage);

          // push donation date to array
          facebookDonations.push({
            name: name,
            currency: currency,
            amount: amount,
            profileUrl: profileUrl,
            imgDataUri: imgDataUri,
            date: exactDateTime,
            message: donationMessage
          });

        }

        console.log('scrape complete');
        await this.browser.close();
        return {
          progressCard: progressCard,
          uniqueDonorCount: uniqueDonorCount,
          donations: facebookDonations
        };

      } catch (err) {

        console.log(err);
        return {
          progressCard: {
            total: 0,
            goal: 0
          },
          uniqueDonorCount: 0,
          donations: []
        };

      }

    })();
  }

  // //a[contains(@href, "10156747884061191") and parent::span]
  @post('/facebook/fundraiser/{facebookFundraiserId}/{donationId}/{reaction}')
  reactToDonation(
    @param.path.number('facebookFundraiserId', {
      description: 'Unique Facebook Fundraiser Id',
      content: { ['number']: {
          example: 655011391974449
        }}
    }) facebookFundraiserId: number,
    @param.path.string('donationId', {
      description: 'Unique Donation Id',
      content: { ['string']: {
          example: '10156747884061191'
        }}
    }) donationId: string,
    @param.path.string('reaction', {
      description: 'The reaction you want to perform',
      content: { ['string']: {
          example: 'Like'
        }}
    }) reaction: string,
  ): object {
    return (async () => {

      try {

        await this.launchBrowser();
        await this.loginIfRequired();

        // load donation page
        await this.page.goto(`https://www.facebook.com/donate/${facebookFundraiserId}/${donationId}`, {waitUntil: 'networkidle2'});

        // render all the lazy loaded content in the page from infinite scroll
        let previousHeight;
        while (true) {
          try {
            previousHeight = await this.page.evaluate('document.body.scrollHeight');
            await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await this.page.waitForFunction(`document.body.scrollHeight > ${previousHeight}`);
          } catch (e) {
            console.log('Scrolled to end of donation feed');
            break;
          }
        }

        // trick donation id links to appear
        console.log('trick donation id links to appear');
        await this.page.waitForXPath('//div[@role=\'feed\']/div[position()>2]');
        const facebookDonationElems: ElementHandle[] = await this.page.$x('//div[@role=\'feed\']/div[position()>2]');
        for (let i = 0; i < facebookDonationElems.length; i++) {
          await facebookDonationElems[i].click(); // scroll to element
          await this.captureExactDateTime(facebookDonationElems, i);
        }

        // get reactions to appear
        console.log('getting reactions to appear');
        await this.page.waitForXPath(`//a[contains(@href, \"${donationId}\") and parent::span]`);
        const [reactButtonElem]: ElementHandle[] = await this.page.$x(`//a[contains(@href, \"${donationId}\") and parent::span]/parent::span/parent::span/parent::span/parent::span/parent::div/parent::div/parent::div/parent::div/parent::div/following-sibling::div[2]/div/div/div/div/div[2]/div/div/div`);
        await reactButtonElem.evaluate(selector => selector.scrollIntoView());
        await reactButtonElem.focus();
        await reactButtonElem.hover();
        await this.page.waitForXPath('//canvas[@width=39]');

        // click reaction
        console.log('clicking reaction');
        switch (reaction) {
          case 'Like':
            const [likeButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Like\"]');
            await likeButton.click();
            break;
          case 'Love':
            const [loveButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Love\"]');
            await loveButton.click();
            break;
          case 'Care':
            const [careButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Care\"]');
            await careButton.click();
            break;
          case 'Haha':
            const [hahaButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Haha\"]');
            await hahaButton.click();
            break;
          case 'Wow':
            const [wowButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Wow\"]');
            await wowButton.click();
            break;
          case 'Sad':
            const [sadButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Sad\"]');
            await sadButton.click();
            break;
          case 'Angry':
            const [angryButton] = await this.page.$x('//canvas[@width=39]/parent::div/parent::div/parent::div[@aria-label=\"Angry\"]');
            await angryButton.click();
            break;
        }

        console.log('scrape complete');
        await this.browser.close();
        return true;

      } catch (err) {

        console.log(err);
        return true;

      }

    })();
  }

  private async launchBrowser() {
    this.browser = await puppeteer.launch({headless: false});
    const context = this.browser.defaultBrowserContext();
    await context.overridePermissions("https://www.facebook.com", []);
    this.page = await this.browser.newPage();
    await this.page.setDefaultNavigationTimeout(100000);
    await this.page.setViewport({
      width: 1920,
      height: 920,
      deviceScaleFactor: 1
    });
  }

  private async loginIfRequired() {
    if (!Object.keys(cookiesJson).length) {
      await this.page.goto('https://www.facebook.com/login', {waitUntil: 'networkidle2'}); // 855003971855785
      await this.acceptCookieWarning();
      await this.page.type('#email', config.username, {delay: 30});
      await this.page.type('#pass', config.password, {delay: 30});
      await this.page.click('#loginbutton');
      await this.page.waitForNavigation({ waitUntil: "networkidle0" });
      console.log("waiting 1 min for 2fa");
      await this.page.waitForTimeout(60000);
      try {
        console.log("testing for profile icon");
        await this.page.waitForXPath(`//span[contains(., \'${config.name}\')]`);
      } catch (err) {
        console.log("failed to login");
        process.exit(0);
      }
      let currentCookies = await this.page.cookies();
      console.log("saving cookie", currentCookies);
      await fs.writeFileSync('./facebook-cookies.json', JSON.stringify(currentCookies));
    } else {
      // User Already Logged In
      const cookies: SetCookie[] = [];
      for (const cookieJson of cookiesJson) {
        let tempCookie: SetCookie = {
          name: cookieJson.name,
          value: cookieJson.value,
          domain: cookieJson.domain,
          path: cookieJson.path,
          expires: cookieJson.expires,
          httpOnly: cookieJson.httpOnly,
          session: cookieJson.session,
          secure: cookieJson.secure
        };
        cookies.push(tempCookie)
      }
      await this.page.setCookie(...cookies);
    }
  }

  private getMonthNumber(monthName: string): number {
    const monthNames = ['January', 'February', 'March', 'April', 'May','June','July', 'August', 'September', 'October', 'November','December'];
    return monthNames.findIndex(x => x === monthName);
  }

  private async acceptCookieWarning() {
    // Accept cookie warning banner
    await this.page.waitForSelector('#consent_cookies_title').then(() => {
      return (async () => {
        const [cookieConsentButton] = await this.page.$x('//button[contains(., \'Accept All\')]');
        await cookieConsentButton.click({delay: 100});
      })();
    });
  }

  private async getProgressCard(): Promise<FacebookProgressCard> {
    return await this.page.waitForXPath('//span[contains(.,\'£\')]|//span[contains(.,\'of\')]|//span[contains(.,\'raised\')]').then(() => {
      return (async () => {
        const [progressCardSpan] = await this.page.$x('//span[contains(.,\'£\')]|//span[contains(.,\'of\')]|//span[contains(.,\'raised\')]');
        const progressCardInnerText: string = await this.page.evaluate((el: { textContent: any; }) => el.textContent, progressCardSpan);
        return new Promise<FacebookProgressCard>(resolve => {
          resolve({
            total: parseFloat(progressCardInnerText.split(' ')[0].replace('£', '').replace(',', '')),
            goal: parseFloat(progressCardInnerText.split(' ')[2].replace('£', '').replace(',', ''))
          });
        });
      })();
    });
  }

  private async getUniqueDonorCount(): Promise<number> {
    return await this.page.waitForXPath('//span[contains(., \'donated\')]/preceding-sibling::span[1]').then(() => {
      return (async () => {
        const [uniqueDonorSpan] = await this.page.$x('//span[contains(., \'donated\')]/preceding-sibling::span[1]');
        const uniqueDonorSpanInnerText: string = await this.page.evaluate((el: { textContent: any; }) => el.textContent, uniqueDonorSpan);
        return new Promise<number>(resolve => {
          resolve(parseInt(uniqueDonorSpanInnerText));
        });
      })();
    });
  }

  private async captureNameAmount(donationElems: ElementHandle[], i: number): Promise<string> {
    return await this.page.waitForXPath('.//span[contains(., \'donated £\')]', { timeout: 2000 }).then(() => {
      return (async () => {
        const [facebookDonationNameAmount]: ElementHandle[] = await donationElems[i].$x('.//span[contains(., \'donated £\')]');
        const nameAmount: string = await this.page.evaluate(el => {
          return el !== undefined ? el.textContent : 'undefined';
        }, facebookDonationNameAmount);
        return new Promise<string>(resolve => {
          resolve(nameAmount);
        });
      })();
    });
  }

  private async captureDonationId(donationElems: ElementHandle[], i: number): Promise<number> {
    return await this.page.waitForXPath('.//a[contains(@href, \"donate\")]').then(() => {
      return (async () => {
        const [donationIdElem]: ElementHandle[] = await donationElems[i].$x('.//a[contains(@href, \"donate\")]');
        await donationIdElem.focus();
        let donationId = await this.page.evaluate(el => el.getAttribute('href'), donationIdElem);
        console.log('donationId', donationId);
        donationId = parseInt(donationId.split(/\?/gi)[0].split(/\//gi).pop());
        return new Promise<number>(resolve => {
          resolve(donationId);
        });
      })();
    });
  }

  private async captureProfileUrl(donationElems: ElementHandle[], i: number): Promise<string> {
    return await this.page.waitForXPath('.//a').then(() => {
      return (async () => {
        const [profileUrlElem]: ElementHandle[] = await donationElems[i].$x('.//a');
        let profileUrl = await this.page.evaluate(el => el.getAttribute('href'), profileUrlElem);
        profileUrl = profileUrl.split(/&|\?(?!id)/gi)[0];
        return new Promise<string>(resolve => {
          resolve(profileUrl);
        });
      })();
    });
  }

  private async captureImgDataUri(donationElems: ElementHandle[], i: number): Promise<string> {
    return await this.page.waitForXPath('.//*[name()=\'image\']').then(() => {
      return (async () => {
        const [imgSrcElem]: ElementHandle[] = await donationElems[i].$x('.//*[name()=\'image\']');
        const imgSrc = await this.page.evaluate(el => el.getAttribute('xlink:href'), imgSrcElem);
        const imgDataUri = await imageDataURI.encodeFromURL(imgSrc);
        return new Promise<string>(resolve => {
          resolve(imgDataUri);
        });
      })();
    });
  }

  private async captureExactDateTime(donationElems: ElementHandle[], i: number): Promise<Date> {
    return await this.page.waitForXPath('.//span[contains(., \'donated £\')]/parent::div/parent::div/div[2]/span/span/span[2]/span/a/span/span/span[2]').then(() => {
      return (async () => {
        const [facebookDonationDate]: ElementHandle[] = await donationElems[i].$x('.//span[contains(., \'donated £\')]/parent::div/parent::div/div[2]/span/span/span[2]/span/a/span/span/span[2]');
        const boundingBox = await facebookDonationDate.boundingBox();
        if (boundingBox) await this.page.mouse.move(boundingBox.x, boundingBox.y);
        await this.page.waitForXPath('//span[@role=\'tooltip\']/div/div/span');
        await this.page.waitForTimeout(300);
        const [facebookDonationExactDate] = await donationElems[i].$x('//span[@role=\'tooltip\']/div/div/span');
        const exactDateTimeEval: string = await this.page.evaluate(el => el?.innerHTML, facebookDonationExactDate);
        console.log('exactDateTimeEval:', exactDateTimeEval);
        // convert date string
        const d: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[1]);
        const mmmm: string = exactDateTimeEval.split(/[\s,:]+/gi)[2];
        const yyyy: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[3]);
        const hh: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[5]);
        const nn: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[6]);
        console.log('date:', 'd:', d, 'mmmm:', mmmm, this.getMonthNumber(mmmm), 'yyyy:', yyyy, 'hh:', hh, 'nn:', nn);
        const exactDateTime: Date = new Date();
        exactDateTime.setDate(d);
        exactDateTime.setMonth(this.getMonthNumber(mmmm));
        exactDateTime.setFullYear(yyyy);
        exactDateTime.setHours(hh);
        exactDateTime.setMinutes(nn);
        exactDateTime.setSeconds(0);
        exactDateTime.setMilliseconds(0);
        return new Promise<Date>(resolve => {
          resolve(exactDateTime);
        });
      })();
    });
  }

  private async captureDonationMessage(i: number): Promise<string> {
    return await this.page.waitForXPath(`//div[@role=\"feed\"]/div[position()=${i+3}]//span[contains(., \"donated £\")]/parent::div/parent::div/parent::div/parent::div/parent::div/following-sibling::div[1]`).then(() => {
      return (async () => {
        let donationMessage: string = '';
        const [facebookDonationMessage]: ElementHandle[] = await this.page.$x(`//div[@role=\"feed\"]/div[position()=${i+3}]//span[contains(., \"donated £\")]/parent::div/parent::div/parent::div/parent::div/parent::div/following-sibling::div[1]`);
        const boundingBox: BoundingBox|null = await facebookDonationMessage.boundingBox();
        // console.log('height: ', await boundingBox?.height);
        if (boundingBox !== undefined && boundingBox !== null && boundingBox.height > 0) {
          const donationMessageEval: any = await this.page.evaluate(el => el.textContent, facebookDonationMessage);
          donationMessage = donationMessageEval;
        }
        return new Promise<string>(resolve => {
          resolve(donationMessage);
        });
      })();
    });
  }

}

interface FacebookProgressCard {
  total: number;
  goal: number;
}

interface FacebookDonation {
  id?: number;
  name: string;
  currency: string;
  amount: number;
  profileUrl: string;
  imgDataUri: string;
  date: Date;
  message: string;
}

