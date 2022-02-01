import { inject } from '@loopback/core';
import { Request, RestBindings, get, post, param } from '@loopback/rest';
import { BoundingBox, Browser, ElementHandle, Page } from 'puppeteer';
import moment from 'moment';
const puppeteer = require('puppeteer');
const imageDataURI = require('image-data-uri');
import * as fs from 'fs';


/**
 * A simple controller to scrape facebook data from fundraising page
 */
export class FacebookFundraiserController {

  private configJsonFile = 'src/controllers/facebook-fundraiser/facebook-config.json';
  private facebookConfig: FacebookConfig;
  private cookiesJsonFile = 'src/controllers/facebook-fundraiser/facebook-cookies.json';
  private cookiesJson: SetCookie[] = [];

  private browser: Browser;
  private page: Page;

  private ROUNDED_DIVS_$$ = 'div[style="border-radius: max(0px, min(8px, ((100vw - 4px) - 100%) * 9999)) / 8px;"]';
  // $$('div[style="border-radius: max(0px, min(8px, ((100vw - 4px) - 100%) * 9999)) / 8px;"]')
  private DONATIONS_ELEMENT_$$ = 'div:not([class]) > div:not([class]) > div:not([class]) > div:not([class]) > div:first-child > div:nth-child(2)';
  // $$('div:not([class]) > div:not([class]) > div:not([class]) > div:not([class]) > div:first-child > div:nth-child(2)')
  // $$('div:not([class]) > div:not([class]) > div:not([class]) > div:not([class]) > div:first-child > div:nth-child(2)').map(x => x.textContent).filter(x => x.includes('donated £'))
  private DONATION_PROFILE_URL_$$ = 'strong > span > a[role="link"]';
  // $$('strong > span > a[role="link"]')
  private DONATION_DATE_SPAN_$$ = 'span[dir="auto"] > span > span:nth-child(2):not([class])';
  // $$('span[dir="auto"] > span > span:nth-child(2):not([class])')
  private DONATION_DATE_URL_$$ = 'a[role="link"][aria-label]';
  // $$('a[role="link"][aria-label]').map(x => x.href).filter(x => x.includes('https://www.facebook.com/donate'))

  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
    this.facebookConfig = JSON.parse(fs.readFileSync(this.configJsonFile).toString());
    this.cookiesJson = JSON.parse(fs.readFileSync(this.cookiesJsonFile).toString());
  }

  @get('/facebook/fundraiser/{facebookFundraiserId}')
  scrapeFacebookFundraiser(
    @param.path.number('facebookFundraiserId', {
      description: 'Unique Facebook Fundraiser Id',
      content: { ['number']: {
          example: 154880338545073
        }}
    }) facebookFundraiserId: number,
  ): object {
    return (async () => {
      try {

        await this.launchBrowser();
        await this.loginIfRequired();

        // load donation page
        await this.page.goto(`https://www.facebook.com/donate/${facebookFundraiserId}/`, {waitUntil: 'networkidle2'});

        // render all the lazy loaded content in the page from infinite scroll
        let lastHeight = await this.page.evaluate('document.body.scrollHeight');
        while (true) {
          await this.page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
          await this.page.waitForTimeout(2000); // sleep a bit
          let newHeight = await this.page.evaluate('document.body.scrollHeight');
          if (newHeight === lastHeight) {
            break;
          }
          lastHeight = newHeight;
        }

        // get fundraiser details
        const fundraiserDetails: FacebookFundraiserDetails = await this.getFundraiserDetails();

        // get progress_card
        const progressCard: FacebookProgressCard = await this.getProgressCard();

        // get each donation
        const facebookDonations: FacebookDonation[] = [];
        if (progressCard.donated > 0) {

          await this.page.waitForSelector(this.DONATIONS_ELEMENT_$$, {timeout: 1000});
          const fbDonationElHns: Array<ElementHandle> = await this.page.$$(this.DONATIONS_ELEMENT_$$);
          const fbDonationEls: Array<ElementHandle> = [];
          for (let potentialDonationElHn of fbDonationElHns) {
            const textContent = await potentialDonationElHn.evaluate(x => x.textContent);
            if (textContent !== null && textContent.includes('donated £')) {
              fbDonationEls.push(potentialDonationElHn);
            }
          }

          for (let i = 0; i < fbDonationEls.length; i++) {
            await console.log(`Iterating ${ fbDonationEls.length } donationElems ${ await fbDonationEls[i].evaluate((el) => el.textContent) }`);

            // Capture the donation url / id
            const donationId: string = await this.captureDonationId(fbDonationEls[i]);
            console.log('donationId:', donationId);

            // Capture name and amount div
            const nameAmount: string = await this.captureNameAmount(fbDonationEls[i]);
            const name: string|undefined = nameAmount.trim().slice(0, -1).split('donated £')[0];
            const currency: string = 'GBP';
            const amount: number = parseFloat(nameAmount.trim().slice(0, -1).split('donated £')[1]);
            console.log('nameAmount:', nameAmount, name, amount);

            // Capture the profile url
            const profileUrl: string = await this.captureProfileUrl(fbDonationEls[i]);
            console.log('profileUrl:', profileUrl);

            // Capture the imgSrc url
            const imgDataUri: string = await this.captureImgDataUri(fbDonationEls[i]);
            console.log('imgDataUri:', imgDataUri);

            // Capture date div (from tooltip as greater detail includes time)
            const exactDateTime: Date = await this.captureExactDateTime(fbDonationEls[i]);
            console.log('exactDateTime:', exactDateTime);

            // capture message
            // const donationMessage: string = await this.captureDonationMessage(facebookDonationElems, i);
            // console.log('donationMessage:', donationMessage);

            // push donation date to array
            facebookDonations.push({
              id: donationId,
              name: name.trim(),
              currency: currency,
              amount: amount,
              profileUrl: profileUrl,
              imgDataUri: imgDataUri,
              date: exactDateTime,
              message: '', //donationMessage
            });

          }

        }

        console.log('scrape complete');
        await this.browser.close();
        return {
          fundraiserID: facebookFundraiserId,
          fundraiserDetails: fundraiserDetails,
          progressCard: progressCard,
          donations: facebookDonations
        };

      } catch (err) {

        console.log(err);
        return {
          fundraiserID: null,
          progressCard: {
            total: 0,
            goal: 0,
            donated: 0,
            invited: 0,
            shared: 0
          },
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
        await this.page.waitForXPath('//div[@role="feed"]/div[position()>2]');
        const facebookDonationElems: ElementHandle[] = await this.page.$x('//div[@role="feed"]/div[position()>2]');
        for (let i = 0; i < facebookDonationElems.length; i++) {
          await facebookDonationElems[i].click(); // scroll to element
          await this.captureExactDateTime(facebookDonationElems[i]);
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
    if (this.cookiesJson.length === 0) {
      await this.page.goto('https://www.facebook.com/login', {waitUntil: 'networkidle2'}); // 855003971855785
      await this.acceptCookieWarning();
      await this.page.type('#email', this.facebookConfig.username, {delay: 30});
      await this.page.type('#pass', this.facebookConfig.password, {delay: 30});
      await this.page.click('#loginbutton');
      await this.page.waitForNavigation({ waitUntil: "networkidle0" });
      console.log("waiting 30 secs for 2fa");
      await this.page.waitForTimeout(30000);
      try {
        console.log("testing for profile icon");
        await this.page.waitForXPath(`//span[contains(., \'${this.facebookConfig.name}\')]`);
      } catch (err) {
        console.log("failed to login");
        process.exit(0);
      }
      let currentCookies = await this.page.cookies();
      console.log("saving cookie", currentCookies);
      await fs.writeFileSync(this.cookiesJsonFile, JSON.stringify(currentCookies));
    } else {
      // User Already Logged In
      const cookies: SetCookie[] = [];
      for (const cookieJson of this.cookiesJson) {
        let tempCookie: any = {
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
    await this.page.waitForXPath('//button[contains(text(), "Allow All Cookies")]', {timeout: 1000}).then(() => {
      return (async () => {
        const [cookieConsentButton] = await this.page.$x('//button[contains(text(), "Allow All Cookies")]');
        await cookieConsentButton.click({delay: 10});
      })();
    });
  }

  private async getFundraiserDetails(): Promise<FacebookFundraiserDetails> {
    return await this.page.waitForXPath('//div[div[span[span[span[contains(text(),"Fundraiser for")]]]]]/div[1]').then(() => {
      return (async () => {

        const [fundraiserTitleSpan]: ElementHandle[] = await this.page.$x('//div[div[span[span[span[contains(text(),"Fundraiser for")]]]]]/div[1]');
        const fundraiserTitleSpanText: string = await this.page.evaluate(el => el.textContent, fundraiserTitleSpan);
        console.log('fundraiserTitleSpanText', fundraiserTitleSpanText);

        let fundraiserStoryText: string = '';
        let [fundraiserStoryDiv]: ElementHandle[] = await this.page.$x('//div[@style="border-radius: max(0px, min(8px, ((100vw - 4px) - 100%) * 9999)) / 8px;"]//div[div[div[div[div[div[div[h2[span[span[text()="About"]]]]]]]]]]');
        if (!fundraiserStoryDiv) {
          [fundraiserStoryDiv] = await this.page.$x('//div[@style="border-radius: max(0px, min(8px, ((100vw - 4px) - 100%) * 9999)) / 8px;"]//div[div[div[div[div[div[div[span[div[div[h2[span[span[text()="About"]]]]]]]]]]]]]');
          const [fundraiserStorySeeMoreButton]: ElementHandle[] = await fundraiserStoryDiv.$x('.//div[text()="See more"]');
          await fundraiserStorySeeMoreButton.click({delay: 300});
          fundraiserStoryText = await this.page.evaluate(el => el.textContent, fundraiserStoryDiv);
        }
        console.log('fundraiserStorySpanText', fundraiserStoryText);

        const [fundraiserCoverImageElem]: ElementHandle[] = await this.page.$x('//img[@data-imgperflogname="profileCoverPhoto"]');
        const fundraiserCoverImageSrc = await this.page.evaluate(el => el.getAttribute('src'), fundraiserCoverImageElem);
        const fundraiserCoverImageDataSrc = await imageDataURI.encodeFromURL(fundraiserCoverImageSrc);

        const [fundraiserExpiredSpan]: ElementHandle[] = await this.page.$x('//span[text()="Fundraiser has ended"]');
        let fundraiserExpiryDateSpanDays: number = 0;
        if (!fundraiserExpiredSpan) {
          const [fundraiserExpiryDateSpan]: ElementHandle[] = await this.page.$x('//span[contains(text()," days left")]');
          const fundraiserExpiryDateSpanText: string = await this.page.evaluate(el => el.textContent, fundraiserExpiryDateSpan);
          fundraiserExpiryDateSpanDays = parseInt(fundraiserExpiryDateSpanText.slice(0,fundraiserExpiryDateSpanText.length - 'days left'.length).trim(), 10);
        }
        console.log('fundraiserExpiryDateSpanDays', fundraiserExpiryDateSpanDays);

        const fundraiserDetailsLinks: ElementHandle[] = await this.page.$x('//span[contains(text(),"Fundraiser for")]/a');
        const charityLinkText: string = await this.page.evaluate(el => el.textContent, fundraiserDetailsLinks[0]);
        const charityLinkHref: string = await this.page.evaluate(el => el.href, fundraiserDetailsLinks[0]);
        console.log('charity', charityLinkText, charityLinkHref);

        const fundraiserLinkText: string = await this.page.evaluate(el => el.textContent, fundraiserDetailsLinks[1]);
        const fundraiserLinkHref: string = await this.page.evaluate(el => el.href, fundraiserDetailsLinks[1]);
        console.log('fundraiser', fundraiserLinkText, fundraiserLinkHref);

        return new Promise<FacebookFundraiserDetails>(resolve => {
          resolve({
            title: fundraiserTitleSpanText,
            story: fundraiserStoryText,
            coverImage: fundraiserCoverImageDataSrc,
            charity: charityLinkText,
            charityUrl: charityLinkHref,
            fundraiser: fundraiserLinkText,
            fundraiserUrl: fundraiserLinkHref,
            eventDate: new Date(moment.now()),
            expiryDate: moment().add(fundraiserExpiryDateSpanDays, 'd').toDate(),
            currencyCode: 'GBP',
            currencySymbol: '£'
          });
        });
      })();
    });
  }

  private async getProgressCard(): Promise<FacebookProgressCard> {
    return await this.page.waitForXPath('//span[contains(text(), "of £") and contains(text(), "raised")]').then(() => {
      return (async () => {
        const [progressCardSpan]: ElementHandle[] = await this.page.$x('//span[contains(text(), "of £") and contains(text(), "raised")]');
        const progressCardInnerText: string = await this.page.evaluate(el => el.textContent, progressCardSpan);

        const [fundraiserProgressCard]: ElementHandle[] = await this.page.$x('//div[div[contains(@role,"button")]/div/span[contains(text(),"donated") and @dir="auto"]]');
        const [fpDonatedElementHandle]: ElementHandle[] = await fundraiserProgressCard.$x('.//*[contains(text(),"donated")]/..');
        const fpDonatedText: string = await this.page.evaluate(el => el.textContent, fpDonatedElementHandle);
        const [fpInvitedElementHandle]: ElementHandle[] = await fundraiserProgressCard.$x('.//*[contains(text(),"invited")]/..');
        const fpInvitedText: string = await this.page.evaluate(el => el.textContent, fpInvitedElementHandle);
        const [fpSharedElementHandle]: ElementHandle[] = await fundraiserProgressCard.$x('.//*[contains(text(),"shared")]/..');
        const fpSharedText: string = await this.page.evaluate(el => el.textContent, fpSharedElementHandle);

        return new Promise<FacebookProgressCard>(resolve => {
          resolve({
            total: parseFloat(progressCardInnerText.match(/(?!\£)([\d\,]+)(?=\sof)/g)![0].replace(/\,/g, '')),
            goal: parseFloat(progressCardInnerText.match(/(?!\£)([\d\,]+)(?=\sraised)/g)![0].replace(/\,/g, '')),
            donated: parseFloat(fpDonatedText.replace(/donated/g, '')),
            invited: parseFloat(fpInvitedText.replace(/invited/g, '')),
            shared: parseFloat(fpSharedText.replace(/shared/g, ''))
          });
        });
      })();
    });
  }

  private async captureNameAmount(donationElem: ElementHandle): Promise<string> {
    return await donationElem.evaluate(el => el.textContent)
      .then((data) => {
        return new Promise<string>(resolve => {
          resolve(data!);
        })
      })
      .catch((err) => {
        console.log(err);
        return new Promise<string>(resolve => {
          resolve('');
        });
      });
  }

  private async captureProfileUrl(donationElem: ElementHandle): Promise<string> {
    const [profileUrlElem]: ElementHandle[] = await donationElem.$x('.//a');
    let profileUrl = await this.page.evaluate(el => el.getAttribute('href'), profileUrlElem);
    profileUrl = profileUrl.split(/&|\?(?!id)/gi)[0];
    return new Promise<string>(resolve => {
      resolve(profileUrl);
    });
  }

  private async captureDonationId(donationElem: ElementHandle): Promise<string> {
    const donorUrlEh: ElementHandle<Element> = await donationElem.$(this.DONATION_DATE_URL_$$).then();
    await donorUrlEh.focus();
    const boundingBox: BoundingBox = await donorUrlEh.boundingBox().then();
    let donationId: string = '';
    if (boundingBox) {
      await this.page.mouse.move(boundingBox.x, boundingBox.y);
      const donationDateHref: string = await donorUrlEh.evaluate((el) => el.getAttribute('href')).then();
      const regex = new RegExp(/(?<=https:\/\/www\.facebook\.com\/donate\/)(\d+\/\d+)/);
      if (regex.test(donationDateHref)) {
        // @ts-ignore
        donationId = donationDateHref.match(regex)[0];
      }
    }
    return new Promise<string>(resolve => {
      resolve(donationId);
    });
  }

  private async captureImgDataUri(donationElem: ElementHandle): Promise<string> {
    try {
      // @ts-ignore
      const imgSrc = await donationElem.evaluate(el => el.parentElement.querySelector('image').getAttribute('xlink:href'));
      const imgDataUri = await imageDataURI.encodeFromURL(imgSrc);
      return new Promise<string>(resolve => {
        resolve(imgDataUri);
      });
    } catch (err) {
      return new Promise<string>(resolve => {
        resolve('');
      });
    }
  }

  private async captureExactDateTime(donationElem: ElementHandle): Promise<Date> {
    try {
      const donorUrlEh: ElementHandle<Element> = await donationElem.$(this.DONATION_DATE_URL_$$).then();
      await donorUrlEh.focus();
      const boundingBox: BoundingBox = await donorUrlEh.boundingBox().then();
      if (boundingBox) {
        await this.page.mouse.move(boundingBox.x, boundingBox.y);
        await this.page.waitForXPath('//span[@role="tooltip"]/div/div/span', {timeout: 1500});
        const [facebookDonationExactDate] = await donationElem.$x('//span[@role="tooltip"]/div/div/span');
        const exactDateTimeEval: string = await this.page.evaluate((el) => el.innerHTML, facebookDonationExactDate);
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
      }
    } catch (err) {
      console.log('captureExactDateTime err: ', err);
    }
    return new Promise<Date>(resolve => {
      resolve(new Date());
    });
  }

  private async captureDonationMessage(donationElems: ElementHandle[], i: number): Promise<string> {
    try {
      return await this.page.waitForXPath('//div[@role="feed"]/div/.//*[contains(text(), "donated")]/./../../../.././/div[@dir="auto" and not(contains(@style, "text-align"))]', {timeout:500}).then(() => {
        return (async () => {
          let donationMessage: string = '';
          const [facebookDonationMessage]: ElementHandle[] = await donationElems[i].$x('.//div[@dir="auto" and not(contains(@style, "text-align"))]');
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
    } catch (err) {
      // console.log('Donation has no message. ', err);
      return new Promise<string>(resolve => {
        resolve('');
      });
    }
  }

}

interface FacebookFundraiserDetails {
  title: string;
  story: string;
  coverImage: string;
  charity: string;
  charityUrl: string;
  fundraiser: string;
  fundraiserUrl: string;
  eventDate: Date;
  expiryDate: Date;
  currencyCode: string;
  currencySymbol: string;
}

interface FacebookProgressCard {
  total: number;
  goal: number;
  donated: number;
  invited: number;
  shared: number;
}

interface FacebookDonation {
  id: string;
  name: string;
  currency: string;
  amount: number;
  profileUrl: string;
  imgDataUri: string;
  date: Date;
  message: string;
}

interface FacebookConfig {
  username: string;
  password: string;
  name: string;
}

interface SetCookie {
  name: any;
  value: any;
  domain: any;
  path: any;
  expires: any;
  httpOnly: any;
  session: any;
  secure: any;
}