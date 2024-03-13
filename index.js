const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const express = require('express')
const { WebUntis } = require("webuntis");
const {google} = require('googleapis');
const CONFIG = require('./config.json');
const {web} = require("./client.json")
const schedule = require('node-schedule');

const app = express()
const port = 8080
const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

const untis = new WebUntis(
  CONFIG.SCHOOL_WEBUNTIS,
  CONFIG.USERNAME_WEBUNTIS,
  CONFIG.PASSWORD_WEBUNTIS,
  CONFIG.DOMAIN_WEBUNTIS
);
const calendar = google.calendar({
  version: "v3",
  auth: CONFIG.API_KEY
})

const OAuth2Client = new google.auth.OAuth2(web.client_id, web.client_secret, web.redirect_uris[0])

const url = OAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
});


OAuth2Client.on('tokens', async (tokens) => {
  if (tokens.refresh_token) {
    const payload = JSON.stringify(tokens);

    await fs.writeFile(TOKEN_PATH, payload);
  }
});

async function listEvents(timeMin, timeMax) {
  const res = await calendar.events.list({
    calendarId: CONFIG.CALENDARID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    auth: OAuth2Client
  });

  const events = res.data.items;
  if (!events || events.length === 0) {
    return;
  }

  return events
}

async function createEvent(startTime, endTime, summary, colorId, roomId, homeWork) {
    var event = {
        'summary': summary,
        'location': 'Heerstraße 150, 78628 Rottweil, Deutschland',
        'start': {
          'dateTime': startTime,
          'timeZone': 'Europe/Berlin'
        },
        'end': {
          'dateTime': endTime,
          'timeZone': 'Europe/Berlin'
        },
        'colorId': colorId ?? (CONFIG.COLORS.STANDARD - 1),
        'description': `Room -> <b>${roomId}</b><br>HomeWork -> <b>${homeWork ? homeWork.text : "No Homework"}</b>`,
        'reminders': {
          'useDefault': false,
          'overrides': []
        },
      };

    if(colorId == CONFIG.COLORS.EXAM) {
      event.reminders = {
        'useDefault': false,
        'overrides': [
          {'method': 'popup', 'minutes': 24 * 60 * 7},
          {'method': 'popup', 'minutes': 24 * 60 * 3},
          {'method': 'popup', 'minutes': 24 * 60 * 1}
        ]
      }
    }

    if(homeWork) {
      event.reminders = {
        'useDefault': false,
        'overrides': [
          {'method': 'popup', 'minutes': 24 * 60 * 3},
          {'method': 'popup', 'minutes': 24 * 60 * 1}
        ]
      }
    }

    await calendar.events.insert({
        'calendarId': CONFIG.CALENDARID,
        'resource': event,
        auth: OAuth2Client
      });
}

async function editEvent(eventId, startTime, endTime, summary, colorId, roomId, homeWork) {
  var event = {
      'summary': summary,
      'location': 'Heerstraße 150, 78628 Rottweil, Deutschland',
      'start': {
        'dateTime': startTime,
        'timeZone': 'Europe/Berlin'
      },
      'end': {
        'dateTime': endTime,
        'timeZone': 'Europe/Berlin'
      },
      colorId: colorId ?? CONFIG.COLORS.STANDARD - 1,
      'description': `Room -> <b>${roomId}</b><br>HomeWork -> <b>${homeWork ? homeWork.text : "No Homework"}</b>`,
      'reminders': {
        'useDefault': false,
        'overrides': []
      },
    };

  if(colorId == CONFIG.COLORS.EXAM) {
    event.reminders = {
      'useDefault': false,
      'overrides': [
        {'method': 'popup', 'minutes': 24 * 60 * 7},
        {'method': 'popup', 'minutes': 24 * 60 * 3},
        {'method': 'popup', 'minutes': 24 * 60 * 1}
      ]
    }
  }

  if(homeWork) {
    event.reminders = {
      'useDefault': false,
      'overrides': [
        {'method': 'popup', 'minutes': 24 * 60 * 3},
        {'method': 'popup', 'minutes': 24 * 60 * 1}
      ]
    }
  }

  await calendar.events.update({
      'calendarId': CONFIG.CALENDARID,
      'eventId': eventId,
      requestBody: event,
      auth: OAuth2Client
    });
}

function nextweek(week, addUp){
  var today = new Date();
  var nextweek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + addUp + (7 * week));
  return nextweek;
}

function formatDate(dateString) {
  return dateString.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
}

async function getTokensWithRefreshToken() {
  const credentials = await fs.readFile(TOKEN_PATH).then(JSON.parse).catch(() => ({}));

  if(credentials.access_token && credentials.refresh_token) {
    OAuth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    })

    const ref = await OAuth2Client.refreshAccessToken()
    OAuth2Client.setCredentials(ref.credentials)
    return;
  }
}

async function doesFileExist(path) {
  const credentials = await fs.readFile(TOKEN_PATH).then(JSON.parse).catch(() => ({}));
  return Boolean(credentials.access_token && credentials.refresh_token);
}


async function main() {
    console.log("Running")
    let count = 1;
    await untis.login();

    while (count != CONFIG.WEEKCOUNT) {
        const firstWeekFromToday = count == 1 ? new Date() : nextweek(count - 1, 0)
        const nextWeekEndFromToday = nextweek(count, 0)
        let eventsFromCalendar = await listEvents(firstWeekFromToday.toISOString(), nextWeekEndFromToday.toISOString());
        if(!eventsFromCalendar) eventsFromCalendar = []
        eventsFromCalendar = eventsFromCalendar.filter(event => event.colorId == CONFIG.COLORS.STANDARD || event.colorId == CONFIG.COLORS.EXAM || event.colorId == (CONFIG.COLORS.STANDARD - 1))
        let timetable = await untis.getOwnTimetableForWeek(nextweek(count - 1, 1)); 
        timetable = timetable.filter(timetable => {
          const baseDate = new Date(formatDate(timetable.date.toString()))
          const startTime = WebUntis.convertUntisTime(timetable.startTime, baseDate)
          return startTime > new Date()
        }) 
        const homework = await untis.getHomeWorksFor(firstWeekFromToday, nextWeekEndFromToday);  

        if(timetable.length) {
            for (let i = 0; i < timetable.length; i++) {
                if(timetable[i].cellState == "CANCEL") continue;

                const baseDate = new Date(formatDate(timetable[i].date.toString()))
                const startTime = WebUntis.convertUntisTime(timetable[i].startTime, baseDate)
                const endTime = WebUntis.convertUntisTime(timetable[i].endTime, baseDate)
                const summary = timetable[i]?.subjects[0]?.element.longName ?? "No Subject Found"
                const roomId = timetable[i]?.rooms[0]?.element.longName ?? "No Room Found"
                const homeWork = homework.homeworks.find(homework => homework.lessonId == timetable[i].lessonId && homework.date.toString() == timetable[i].date.toString())
                const findEvent = eventsFromCalendar.find(event => {
                  const eventStartTime = new Date(event.start.dateTime)
                  const eventEndTime = new Date(event.end.dateTime)
                  return eventStartTime.getTime() == startTime.getTime() && eventEndTime.getTime() == endTime.getTime() && event.summary == summary
                });
                
                if(!findEvent)  {
                    await createEvent(startTime, endTime, summary, CONFIG.COLORS[timetable[i].cellState], roomId, homeWork)
                }

                if(findEvent && findEvent.description !== `Room -> <b>${roomId}</b><br>HomeWork -> <b>${homeWork ? homeWork.text : "No Homework"}</b>`) {
                    await editEvent(findEvent.id, startTime, endTime, summary, CONFIG.COLORS[timetable[i].cellState], roomId, homeWork)
                }
            }
        }
        count += 1;
    }
    return;
}

const job = schedule.scheduleJob('0 */2 * * *', async function(){
  await getTokensWithRefreshToken();
  await main();
  console.log("job ran at -> ", new Date().toISOString())
});


(async () => {
  const fileExist = await doesFileExist(TOKEN_PATH);
  if(fileExist) {
    console.log("File Exists Job Started!")
    job.job();
  } else {
    console.log("File Doesn't Exist!")
  }
})();

app.get('/', async (req, res) => {
    const code = req.query.code;

    const fileExists = await doesFileExist(TOKEN_PATH)

    if(code && !fileExists) {
      const {tokens} = await OAuth2Client.getToken(code)
    
      OAuth2Client.setCredentials(tokens)
  
      res.send("Everything is set up!");

      job.job();
    } else {
      res.send("It's already set up!")
    }
})

const server = app.listen(port, () => {
  console.log(`Example app listening at ${port}`)
  console.log(url, " -> URL")
})

server.keepAliveTimeout = 2147483646;
server.headersTimeout = 2147483647;