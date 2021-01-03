const veracodeApi = require('./veracode/query.js')

const SCAN_NAME = 'Veracode SAST'

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
  // Your code here
  app.log('Yay, the app was loaded!')

  app.on(['pull_request.edited', 'pull_request.opened', 'pull_request.synchronize'], async context => {
    context.log({ event: context.event, action: context.payload.action })
    // context.log({ "context name": context.name });
    // context.log({ pull_request: context.payload.pull_request });
    /*
    const number = context.payload.pull_request.number;
    const {owner,repo} = context.repo();
    //const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
    //return context.github.issues.createComment(issueComment)
    console.log('\nPull request');
    let pr = await context.github.pulls.get({owner: owner,repo:repo,pull_number:number});
    console.log(pr);
    let commit_sha = pr.data.head.sha;

    let veracode_check_suite = undefined;
    console.log('\nchecks suite data');
    let suites = await context.github.checks.listSuitesForRef({owner:owner,repo:repo,ref:commit_sha});
    console.log(suites.data);
    suites.data.check_suites.map(suite => {
      console.log('Suite id: '+suite.id);
      console.log('suite apps:\n'+JSON.stringify(suite.app));
      console.log('suite pulls:\n'+JSON.stringify(suite.pull_requests));
    })

    console.log('\nchecks run data');
    let checks = await context.github.checks.listForRef({
      owner:owner,
      repo:repo,
      ref:commit_sha,
    });
    console.log(checks.data);
    checks.data.check_runs.map(run => {
      console.log('run id:'+run.id);
      console.log('run from suites: '+JSON.stringify(run.check_suite));
      console.log('run name: '+run.name);
      console.log('run output:\n'+JSON.stringify(run.output));
      console.log('run details URL: '+run.details_url);
    })

    */
  })

  app.on(['check_suite.requested', 'check_suite.rerequested'], async context => {
    createCheckRun(context)
  })

  app.on(['check_run.created', 'check_run.rerequested'], async context => {
    const action = context.payload.action
    if (action === 'created') {
      initiateCheckRun(context)
    } else {
      context.github.checks.update({
        name
      })
      createCheckRun(context)
    }
  })

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}

const createCheckRun = (context) => {
  context.log({ event: context.event, action: context.payload.action })
  context.log({ 'context name': context.name })
  context.log({ payload: context.payload })

  const { owner, repo } = context.repo()

  context.github.checks.create({
    owner: owner,
    repo: repo,
    name: SCAN_NAME,
    head_sha: context.payload.check_suite.head_sha
  })
}

const initiateCheckRun = async (context) => {
  const { owner, repo } = context.repo()
  const checkRunId = context.payload.check_run.id

  context.github.checks.update({
    owner: owner,
    repo: repo,
    check_run_id: checkRunId,
    status: 'in_progress',
    started_at: new Date().toISOString()
  })

  const statusResponse = await veracodeApi.getStatus('38e46921-3ba5-4dd3-8d05-0414d4556f33', '791009')
  console.log(statusResponse)

  context.github.checks.update({
    owner: owner,
    repo: repo,
    check_run_id: checkRunId,
    status: 'completed',
    completed_at: new Date().toISOString(),
    conclusion: statusResponse.conclusion,
    details_url: statusResponse.details_url,
    output: {
      summary: statusResponse.output_summary,
      title: 'Veracode SAST scan results'
    }
  })
}
