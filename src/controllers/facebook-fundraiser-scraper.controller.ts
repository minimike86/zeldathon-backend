import {inject} from '@loopback/core';
import {
  Request,
  RestBindings,
  get,
  param
} from '@loopback/rest';

const puppeteer = require('puppeteer');
import {ElementHandle, Page, SetCookie} from 'puppeteer';

const imageDataURI = require('image-data-uri');

import * as fs from 'fs';
import config from './config.json';
import cookiesJson from './cookies.json';


/**
 * A simple controller to scrape facebook data from fundraising page
 */
export class ScrapeFacebookFundraiserController {

  public page: Page;

  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
  }

  @get('/scrape/facebook/donate/{facebookFundraiserId}')
  scrape(
      @param.path.number('facebookFundraiserId') facebookFundraiserId: number,
  ): object {
    return (async () => {
      const browser = await puppeteer.launch({headless: false});
      const context = browser.defaultBrowserContext();
      await context.overridePermissions("https://www.facebook.com", []);
      this.page = await browser.newPage();
      await this.page.setDefaultNavigationTimeout(100000);
      await this.page.setViewport({
        width: 1920,
        height: 920,
        deviceScaleFactor: 1
      });
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
        await fs.writeFileSync('./cookies.json', JSON.stringify(currentCookies));
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
      const facebookDonationElems = await this.page.$x('//div[@role=\'feed\']/div[position()>2]');
      console.log(`Grabbing ${facebookDonationElems.length} donations:`);
      for (let i=0; i<facebookDonationElems.length; i++) {
        await facebookDonationElems[i].click(); // scroll to element

        // Capture name and amount div
        const [facebookDonationNameAmount]: ElementHandle[] = await facebookDonationElems[i].$x('.//span[contains(., \'donated £\')]');
        const nameAmount: string = await this.page.evaluate(el => el.textContent, facebookDonationNameAmount);
        const name: string = nameAmount.trim().slice(0, -1).split('donated £')[0];
        const amount: number = parseFloat(nameAmount.trim().slice(0, -1).split('donated £')[1]);
        // console.log('nameAmount:', nameAmount, name, amount);

        // Capture the profile url
        let profileUrl: string = '';
        const [profileUrlElem]: ElementHandle[] = await facebookDonationElems[i].$x('.//a');
        profileUrl = await this.page.evaluate(el => el.getAttribute('href'), profileUrlElem);
        profileUrl = profileUrl.split('?')[0];
        // console.log('profileUrl:', profileUrl.split('?')[0]);

        // Capture the imgSrc url
        let imgSrc: string = '';
        const [imgSrcElem]: ElementHandle[] = await facebookDonationElems[i].$x('.//*[name()=\'image\']');
        imgSrc = await this.page.evaluate(el => el.getAttribute('xlink:href'), imgSrcElem);
        // console.log('imgSrcElem:', imgSrc);
        const imgDataUri = await imageDataURI.encodeFromURL(imgSrc);
        // console.log('imgDataUri:', imgDataUri);

        // Capture date div (from tooltip as greater detail includes time)
        const [facebookDonationDate]: ElementHandle[] = await facebookDonationElems[i].$x('.//span[contains(., \'donated £\')]/parent::div/parent::div/div[2]/span/span/span[2]/span/a/span/span/span[2]');
        const boundingBox = await facebookDonationDate.boundingBox();
        if (boundingBox) await this.page.mouse.move(boundingBox.x, boundingBox.y);
        await this.page.waitForTimeout(1000);
        const [facebookDonationExactDate] = await facebookDonationElems[i].$x(`//span[@role='tooltip']/div/div/span`);
        const exactDateTimeEval: string = await this.page.evaluate(el => el.innerHTML, facebookDonationExactDate);
        // console.log('exactDateTimeEval:', exactDateTimeEval);
        // convert date string
        const d: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[1]);
        const mmmm: string = exactDateTimeEval.split(/[\s,:]+/gi)[2];
        const yyyy: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[3]);
        const hh: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[5]);
        const nn: number = parseInt(exactDateTimeEval.split(/[\s,:]+/gi)[6]);
        // console.log('date:', 'd:', d, 'mmmm:', mmmm, this.getMonthNumber(mmmm), 'yyyy:', yyyy, 'hh:', hh, 'nn:', nn);
        const exactDateTime: Date = new Date();
        exactDateTime.setDate(d);
        exactDateTime.setMonth(this.getMonthNumber(mmmm));
        exactDateTime.setFullYear(yyyy);
        exactDateTime.setHours(hh);
        exactDateTime.setMinutes(nn);
        exactDateTime.setSeconds(0);
        exactDateTime.setMilliseconds(0);
        // console.log('exactDateTime:', exactDateTime);

        // push donation date to array
        facebookDonations.push({
          name: name,
          amount: amount,
          profileUrl: profileUrl,
          imgSrc: imgSrc,
          imgDataUri: imgDataUri,
          date: exactDateTime
        });

      }

      console.log('scrape complete');
      await browser.close();
      return {
        progressCard: progressCard,
        uniqueDonorCount: uniqueDonorCount,
        donations: facebookDonations
      };
    })();
  }
  
  getMonthNumber(monthName: string): number {
    const monthNames = ['January', 'February', 'March', 'April', 'May','June','July', 'August', 'September', 'October', 'November','December'];
    return monthNames.findIndex(x => x === monthName);
  }

  async acceptCookieWarning() {
    // Accept cookie warning banner
    await this.page.waitForSelector('#consent_cookies_title').then(() => {
      return (async () => {
        const [cookieConsentButton] = await this.page.$x('//button[contains(., \'Accept All\')]');
        await cookieConsentButton.click({delay: 100});
      })();
    });
  }

  async getProgressCard(): Promise<FacebookProgressCard> {
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

  // await this.page.waitForXPath('//span[contains(., \'This fundraiser raised\')]/parent::div/following-sibling::div/div[1]/div[1]/div[1]/span[1]').then(() => {
  async getUniqueDonorCount(): Promise<number> {
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

}

interface FacebookProgressCard {
  total: number;
  goal: number;
}

interface FacebookDonation {
  name: string;
  amount: number;
  profileUrl?: string;
  imgSrc?: string;
  imgDataUri?: string;
  date: Date;
}

