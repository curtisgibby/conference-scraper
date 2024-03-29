const c = require('ansi-colors');
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const cheerio = require('cheerio')
var moment = require('moment');
var request = require('request')
var now = moment();
// var now = moment('2023-04-01'); // manually set to a date in April or October if needed
var year = now.format('YYYY');
var month = now.format('MM');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
	try {
		const content = await fs.readFile(TOKEN_PATH);
		const credentials = JSON.parse(content);
		return google.auth.fromJSON(credentials);
	} catch (err) {
		return null;
	}
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
	const content = await fs.readFile(CREDENTIALS_PATH);
	const keys = JSON.parse(content);
	const key = keys.installed || keys.web;
	const payload = JSON.stringify({
		type: 'authorized_user',
		client_id: key.client_id,
		client_secret: key.client_secret,
		refresh_token: client.credentials.refresh_token,
	});
	await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
	let client = await loadSavedCredentialsIfExist();
	if (client) {
		return client;
	}
	client = await authenticate({
		scopes: SCOPES,
		keyfilePath: CREDENTIALS_PATH,
	});
	if (client.credentials) {
		await saveCredentials(client);
	}
	return client;
}

authorize().then(scrape).catch(console.error);
const rootUrl = 'https://www.churchofjesuschrist.org';
function scrape(auth) {
	request(rootUrl + '/general-conference/' + year + '/' + month + '?lang=eng', function(err, response, body) {
		gotHTML(err, response, body, auth);
	});
}

function gotHTML(err, resp, html, auth) {
	if (err) return console.error(c.red(err))
	const $ = cheerio.load(html)
	var talks = []
	$('.subItems-iyPWM.open-C1MIf a.item-U_5Ca').map(function(i, link) {
		var title = $(link).find('span').text().replace(/\s\s+/g, ' ').trim();
		var author = $(link).find('.subtitle-LKtQp').text().replace(/\s\s+/g, ' ').trim();
		if (author == 'Video Presentation' ||
			title.indexOf('Contents') > -1 ||
			title.indexOf('Sustaining of ') > -1 ||
			title.indexOf('Statistical Report') > -1 ||
			title.indexOf('Auditing Department') > -1
		) {
			return;
		}
		talks.push({
			title: author + ' - ' + title,
			url: rootUrl + $(link).attr('href'),
		});
	})

	// Midnight, Sunday of the first week that we should put talks onto
	var startDate = moment(now, 'YYYY-MM-DD').isoWeekday('Sunday').hours(0).minutes(0).seconds(0);
	var firstDayOfNextAprilOrOctober = now.add(6, 'months').startOf('month') // date of next Conference
	var endDate = firstDayOfNextAprilOrOctober.day() % 6 === 0 ? firstDayOfNextAprilOrOctober : firstDayOfNextAprilOrOctober.add(1, 'week').day(0);

	// console.log('startDate : ', startDate); // debug!
	// console.log('endDate : ', endDate); // debug!
	var a = moment(startDate, 'YYYY-MM-DD');
	var b = moment(endDate, 'YYYY-MM-DD');
	var weeks = b.diff(a, 'weeks');

	var weeksWithTwoTalks = talks.length - weeks;

	var div = Math.floor(weeks/weeksWithTwoTalks);

	talkIndex = 0;
	for (var weekCount = 0; weekCount <= weeks; weekCount++) {
		var talk = talks[talkIndex++];
		if (typeof talk == 'undefined') {
			break;
		}
		var c = moment(startDate, 'YYYY-MM-DD').add(weekCount, 'weeks').add(2, 'days').add(8, 'hours'); // Tuesday!
		saveTalk(talk, c.toISOString(), c.add(15, 'minutes').toISOString(), auth, 2000);

		if ((weekCount % div) == 0) {
			var talk = talks[talkIndex++];
			if (typeof talk == 'undefined') {
				break;
			}
			var c = moment(startDate, 'YYYY-MM-DD').add(weekCount, 'weeks').add(4, 'days').add(8, 'hours'); // Thursday!
			saveTalk(talk, c.toISOString(), c.add(15, 'minutes').toISOString(), auth, 2000);
		}
	}
}

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

async function saveTalk(talk, startDatetime, endDatetime, auth, delayTime) {
	// console.log('saveTalk :', talk.title, startDatetime); // debug!
	// return false; // debug!
	delay(delayTime);
	var calendar = google.calendar('v3');
	calendar.events.insert({
		auth: auth,
		calendarId: "primary",
		resource: {
			start: {
				dateTime: startDatetime,
				timeZone: "America/Denver"
			},
			end: {
				dateTime: endDatetime,
				timeZone: "America/Denver"
			},
			summary: talk.title,
			location: talk.url,
			description: "#ldsconf autogenerated event (" + year + "-" + month + ")"
		}
	}, function (err, success) {
		if (err) {
			var retryMessage = c.red('Will NOT retry');
			if (err.response.config.retry) {
				delay(3000);
				saveTalk(talk, startDatetime, endDatetime, auth, delayTime + 1000);
				retryMessage = c.blue('WILL retry');
			}
			console.error(c.red('Error  '), c.cyan(startDatetime), c.yellow(talk.title), retryMessage);
		} else {
			console.log(c.green('Success'), c.cyan(startDatetime), c.yellow(talk.title));
		}
	})
}
