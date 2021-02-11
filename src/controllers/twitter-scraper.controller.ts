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
import {Browser, ElementHandle, Page, SetCookie} from 'puppeteer';
import cookiesJson from "./twitter-cookies.json";
import config from "./twitter-config.json";
import * as fs from "fs";


export class ScrapeTwitterController {

  public browser: Browser;
  public page: Page;

  constructor(@inject(RestBindings.Http.REQUEST) private req: Request) {
  }

  @post('/scrape/twitter/tweet/')
  postTweet(
      @requestBody({description: 'Sends the provided string as a tweet'}) tweet: string,
  ): object {
    return (async () => {
      await this.launchBrowser();
      await this.loginIfRequired();

      // load donation page
      await this.page.goto(`https://twitter.com/home`, {waitUntil: 'networkidle2'});

      // type in "whats happening" input
      const [whatsHappeningHandle] = await this.page.$x('//div[@class=\'public-DraftStyleDefault-block public-DraftStyleDefault-ltr\']');
      await whatsHappeningHandle.click();
      await whatsHappeningHandle.type(tweet, { delay: 10 });

      // click send
      const [tweetButton] = await this.page.$x('//div[@data-testid=\'tweetButtonInline\']//div');
      await tweetButton.click({ delay: 100 });

      console.log('New Tweet Sent!');
      await this.browser.close();
      return true;
    })();
  }

  @post('/scrape/twitter/tweet/newDonation/')
  postTweetNewDonation(
      @requestBody({
        description: 'Tweets the details of a new donation as a thank you message',
        content: { ['application/json']: {
          example: {donorName: 'Joe Bloggs', currencySymbol: '£', donationAmount: 0.00}
        }}
      }) donationTweet: DonationTweet,
  ): object {
    return (async () => {
      await this.launchBrowser();
      await this.loginIfRequired();

      // load donation page
      await this.page.goto(`https://twitter.com/home`, {waitUntil: 'networkidle2'});

      // type in "whats happening" input
      const [whatsHappeningHandle] = await this.page.$x('//div[@class=\'public-DraftStyleDefault-block public-DraftStyleDefault-ltr\']');
      await whatsHappeningHandle.click();
      await whatsHappeningHandle.type(
          `${donationTweet.donorName} has donated ${donationTweet.currencySymbol}${donationTweet.donationAmount.toFixed(2)} towards the #ZeldathonUK (#10yearanniversary) stream benefitting the charity @SpecialEffect #GameBlast21!\n\nThank you from the @ZeldathonUk team!\n\nWatch Live: https://www.twitch.tv/zeldathonuk\nDonate: https://www.zeldathon.co.uk/donate`
          , { delay: 5 });

      // click send
      const [tweetButton] = await this.page.$x('//div[@data-testid=\'tweetButtonInline\']//div');
      console.log(`Tweeted: ${donationTweet.donorName} has donated ${donationTweet.currencySymbol}${donationTweet.donationAmount.toFixed(2)}...`);
      // await tweetButton.click({ delay: 1000 });

      console.log('New Donation Tweet Sent!');
      await this.browser.close();
      return true;
    })();
  }

  // @get('/scrape/twitter/tweets/{username}')
  // scrapeTwitterTimeline(
  //     @param.path.string('username') username: string,
  // ): object {
  //   return (async () => {
  //     await this.launchBrowser();
  //     await this.loginIfRequired();
  //
  //     // load donation page
  //     await this.page.goto(`https://twitter.com/${username}`, {waitUntil: 'networkidle2'});
  //
  //     // fetch tweets
  //     const tweets: Tweet[] = [];
  //
  //     console.log('scrape complete');
  //     // await this.browser.close();
  //     return true;
  //   })();
  // }

  // @get('/scrape/twitter/search/{typedQuery}')
  // scrapeTwitterSearchHashtag(
  //     @param.path.string('typedQuery') typedQuery: string,
  // ): object {
  //   return (async () => {
  //     await this.launchBrowser();
  //     await this.loginIfRequired();
  //
  //     // load hashtag query page
  //     await this.page.goto(`https://twitter.com/search?q=${typedQuery}%20since%3A2006-01-01&src=typed_query/`, {waitUntil: 'networkidle2'});
  //
  //     // fetch tweets
  //     const tweets: Tweet[] = [];
  //
  //     console.log('scrape complete');
  //     // await browser.close();
  //     return true;
  //   })();
  // }

  async launchBrowser() {
    this.browser = await puppeteer.launch({headless: false});
    const context = this.browser.defaultBrowserContext();
    await context.overridePermissions("https://twitter.com/", []);
    this.page = await this.browser.newPage();
    await this.page.setDefaultNavigationTimeout(100000);
    await this.page.setViewport({
      width: 1920,
      height: 920,
      deviceScaleFactor: 1
    });
  }

  async loginIfRequired() {
    if (!Object.keys(cookiesJson).length) {
      await this.page.goto('https://twitter.com/login', {waitUntil: 'networkidle2'}); // 855003971855785
      const usernameInput = await this.page.$x('//input[@name=\'session[username_or_email]\']');
      await usernameInput[0].type(config.username, {delay: 30});
      const passwordInput = await this.page.$x('//input[@name=\'session[password]\']');
      await passwordInput[0].type(config.password, {delay: 30});
      const loginButton = await this.page.$x('//span[contains(., \'Log in\')]/parent::div');
      await loginButton[0].click();
      await this.page.waitForNavigation({ waitUntil: "networkidle0" });
      console.log("waiting 1 min for 2fa");
      await this.page.waitForTimeout(60000);
      try {
        console.log("testing for profile icon");
        await this.page.waitForXPath(`//img[@alt=\'${config.profileName}\']`);
      } catch (err) {
        console.log("failed to login");
        process.exit(0);
      }
      let currentCookies = await this.page.cookies();
      console.log("saving cookie", currentCookies);
      await fs.writeFileSync('./twitter-cookies.json', JSON.stringify(currentCookies));
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

}

interface DonationTweet {
  donorName: string;
  currencySymbol: string;
  donationAmount: number;
}

interface Tweet {
  profileImgSrc: string;
  name: string;
  username: string;
  date: string;
  content: string;
  replies: number;
  retweets: number;
  likes: number;
}
