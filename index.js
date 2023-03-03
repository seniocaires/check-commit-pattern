const fs = require('fs');
const WORKSPACE_FOLDER = './workspace';
const { spawn } = require('child_process');
const CONFIGURATION = require('./config/configuration.json');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');

schedule.scheduleJob(CONFIGURATION.cron, function () {
  console.log('Cron started');
  run();
});

const transporter = nodemailer.createTransport({
  pool: true,
  host: CONFIGURATION.mailer.host,
  port: CONFIGURATION.mailer.port,
  auth: {
    user: CONFIGURATION.mailer.user,
    pass: CONFIGURATION.mailer.pass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

transporter.verify().then(console.log('E-mail configuration: Success.')).catch(console.error);

const run = async () => {
  try {
    await configWorkspace();

    let repositoriesChecked = [];
    for (let repository of CONFIGURATION.repositories) {
      await clone(repository);
      const repositoryResponse = await checkCommits(repository);
      repositoriesChecked.push(repositoryResponse);
    }
    const fileHasContent = writeLogFile(repositoriesChecked);
    sendEmail(fileHasContent);
  } catch (error) {
    console.error(error);
  }
};

const configWorkspace = async () => {
  fs.rmSync(WORKSPACE_FOLDER, { recursive: true, force: true });
  if (!fs.existsSync(WORKSPACE_FOLDER)) {
    fs.mkdirSync(WORKSPACE_FOLDER, { recursive: true });
  }
};

const clone = async (repository) => {
  fs.rmSync(`${WORKSPACE_FOLDER}/${repository.name}`, { recursive: true, force: true });

  const child = spawn('git', ['clone', `${CONFIGURATION.protocol}://${CONFIGURATION.user}:${CONFIGURATION.pass}@${CONFIGURATION.baseUrl}/${repository.url}`, '-b', `${repository.branch}`, `${WORKSPACE_FOLDER}/${repository.name}`]);

  let data = '';
  for await (const chunk of child.stdout) {
    data += chunk;
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
  });

  if (exitCode) {
    throw new Error(`Error on clone. ${exitCode}. (${repository.name})`);
  }

  return data;
};

const checkCommits = async (repository) => {
  let commitsNotAccepted = [];
  let commitsAccepted = [];

  const child = spawn('git', ['-C', `${WORKSPACE_FOLDER}/${repository.name}`, 'log', `--pretty=format:{"subject": "%f", "commiter": "%cN", "date": "%cD", "email": "%cE"},`]);

  let data = '';
  for await (const chunk of child.stdout) {
    data += chunk;
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.on('close', resolve);
  });

  if (exitCode) {
    throw new Error(`Error on checkCommits. ${exitCode}. (${repository.name})`);
  }

  let dataJSONString = '';
  let dataJSON = '';

  if (data) {
    dataJSONString = '[' + data.slice(0, -1) + ']';
    dataJSON = JSON.parse(dataJSONString);
  }

  const dateNow = new Date();
  let dateLimitLog = new Date();
  dateLimitLog.setDate(dateNow.getDate() - CONFIGURATION.limitDaysBefore);

  for (let index = 0; index < dataJSON.length; index++) {
    let commit = dataJSON[index];
    let commitDate = Date.parse(commit.date);
    if (commitDate >= dateLimitLog) {
      let accept = false;
      for (let pattern of CONFIGURATION.patterns) {
        const regex = new RegExp(pattern);
        if (regex.test(commit.subject)) {
          accept = true;
          break;
        }
      }

      if (accept) {
        commitsAccepted.push(commit);
      } else {
        commitsNotAccepted.push(commit);
      }
    }
  }

  delete repository.commitsAccepted;
  delete repository.commitsNotAccepted;
  repository.commitsAccepted = commitsAccepted;
  repository.commitsNotAccepted = commitsNotAccepted;
  return repository;
};

const writeLogFile = async (repos) => {
  let writeStream = fs.createWriteStream(`${WORKSPACE_FOLDER}/run.log`);
  let fileHasContent = false;

  for (let repo of repos) {
    if ((CONFIGURATION.send.accepted && repo.commitsAccepted.length > 0) || (CONFIGURATION.send.notAccepted && repo.commitsNotAccepted.length > 0)) {
      writeStream.write(`Repository: ${repo.name}\n`);
      writeStream.write(`::::::::::::::::::::::::::::\n\n`);
      fileHasContent = true;
    }

    if (CONFIGURATION.send.accepted) {
      for (let commit of repo.commitsAccepted) {
        writeStream.write(`Subject: ${commit.subject}\n`);
        writeStream.write(`Commiter: ${commit.commiter}\n`);
        const commitDate = new Date(Date.parse(commit.date));
        writeStream.write(`Date: ${commitDate.toLocaleDateString(CONFIGURATION.localeDate)}\n`);
        writeStream.write(`--\n`);
      }
    }
    if (CONFIGURATION.send.notAccepted) {
      for (let commit of repo.commitsNotAccepted) {
        writeStream.write(`Subject: ${commit.subject}\n`);
        writeStream.write(`Commiter: ${commit.commiter}\n`);
        const commitDate = new Date(Date.parse(commit.date));
        writeStream.write(`Date: ${commitDate.toLocaleDateString(CONFIGURATION.localeDate, { hour: '2-digit', minute: '2-digit' })}\n`);
        writeStream.write(`--\n`);
      }
    }

    if ((CONFIGURATION.send.accepted && repo.commitsAccepted.length > 0) || (CONFIGURATION.send.notAccepted && repo.commitsNotAccepted.length > 0)) {
      writeStream.write(`\n\n\n\n`);
    }
  }
  writeStream.end();
  return fileHasContent;
};

const sendEmail = async (sendFile) => {
  let mailOptions = {
    from: CONFIGURATION.mailer.from,
    to: CONFIGURATION.mailer.to,
    subject: `${CONFIGURATION.mailer.subject}`,
  };

  if (sendFile) {
    mailOptions.attachments = [
      {
        filename: 'report.log',
        path: `${WORKSPACE_FOLDER}/run.log`,
      },
    ];
  } else {
    mailOptions.text = CONFIGURATION.mailer.messageOk;
  }

  let info = await transporter.sendMail(mailOptions);

  console.log('Send Email - Success: %s', info.messageId);
};

//run();
