const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
var $ = require('cheerio')
var moment = require('moment');
var request = require('request')
// var now = moment();
var now = moment('2022-04-01'); // manually set to a date in April or October if needed
var year = now.format('YYYY');
var month = now.format('MM');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Calendar API.
  authorize(JSON.parse(content), scrape);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function scrape(auth) {
  request('https://www.churchofjesuschrist.org/general-conference/' + year + '/' + month + '?lang=eng', function(err, response, body) {
      gotHTML(err,response, body, auth);
  });
}

function gotHTML(err, resp, html, auth) {
  if (err) return console.error(err)
  var $html = $.load(html)
  talks = []
  $html('.subItems-iyPWM.open-C1MIf a.item-U_5Ca').map(function(i, link) {
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
    talks.push(title + ' - ' + author);
  })

  // Midnight, Sunday of the first week that we should put talks onto
  var startDate = moment(now, 'YYYY-MM-DD').isoWeekday('Sunday').hours(0).minutes(0).seconds(0);
  var firstDayOfNextAprilOrOctober = now.add(6, 'months').startOf('month') // date of next Conference
  var endDate = firstDayOfNextAprilOrOctober.day() % 6 === 0 ? firstDayOfNextAprilOrOctober : firstDayOfNextAprilOrOctober.add(1, 'week').day(0);

  var a = moment(startDate, 'YYYY-MM-DD');
  var b = moment(endDate, 'YYYY-MM-DD');
  var weeks = b.diff(a, 'weeks');

  var weeksWithTwoTalks = talks.length - weeks;

  var div = Math.floor(weeks/weeksWithTwoTalks);

  talkIndex = 0;
  for (var weekCount = 1; weekCount <= weeks; weekCount++) {
    var talk = talks[talkIndex++];
    if (typeof talk == 'undefined') {
      break;
    }
    var c = moment(startDate, 'YYYY-MM-DD').add(weekCount, 'weeks').add(2, 'days').add(8, 'hours'); // Tuesday!
    saveTalk(talk, c.toISOString(), c.add(15, 'minutes').toISOString(), auth);

    if ((weekCount % div) == 0) {
      var talk = talks[talkIndex++];
      var typeOf = typeof talk;
      if (typeof talk == 'undefined') {
        break;
      }
      var c = moment(startDate, 'YYYY-MM-DD').add(weekCount, 'weeks').add(4, 'days').add(8, 'hours'); // Thursday!
      saveTalk(talk, c.toISOString(), c.add(15, 'minutes').toISOString(), auth);
    }
  }
}

function saveTalk(talk, startDatetime, endDatetime, auth) {
  // console.log('saveTalk :', talk, startDatetime); // debug!
  // return false; // debug!
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
          summary: talk,
          description: "#ldsconf autogenerated event (" + year + "-" + month + ")"
      }
  }, function (err, success) {
      if (err) {
          console.error('Error adding %s at %s', talk, startDatetime, err);
          if (err.reason === 'rateLimitExceeded') {
            saveTalk(talk, startDatetime, endDatetime, auth);
          }
      } else {
          console.log('Successfully added %s at %s', talk, startDatetime);
      }
  })
}
