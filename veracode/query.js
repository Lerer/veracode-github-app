const crypto = require('crypto')
const axios = require('axios')
var convert = require('xml-js')

const id = process.env.VERACODE_API_ID
const key = process.env.VERACODE_API_KEY

const headerPreFix = 'VERACODE-HMAC-SHA-256'
const verStr = 'vcode_request_version_1'

function hmac256 (data, key, format) {
  const hash = crypto.createHmac('sha256', key).update(data)
  if (format === undefined) {
    return hash.digest()
  } else {
    // no format = Buffer / byte array
    return hash.digest(format)
  }
}

function getByteArray (hex) {
  var bytes = []

  for (var i = 0; i < hex.length - 1; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16))
  }

  // signed 8-bit integer array (byte array)
  return Int8Array.from(bytes)
}

module.exports.generateHeader = (host, urlPpath, method) => {
  const localId = id
  const localSecret = key

  var data = `id=${localId}&host=${host}&url=${urlPpath}&method=${method}`
  var timestamp = (new Date().getTime()).toString()
  var nonce = crypto.randomBytes(16).toString('hex')

  // calculate signature
  var hashedNonce = hmac256(getByteArray(nonce), getByteArray(localSecret), undefined)
  var hashedTimestamp = hmac256(timestamp, hashedNonce, undefined)
  var hashedVerStr = hmac256(verStr, hashedTimestamp, undefined)
  var signature = hmac256(data, hashedVerStr, 'hex')

  return `${headerPreFix} id=${localId},ts=${timestamp},nonce=${nonce},sig=${signature}`
}

/*
app_id - new GUID of the application
*/
module.exports.getStatus = async (appId, lagacyId) => {
  const check_run = {
    conclusion: 'neutral',
    output_summary: 'Unavailable',
    details_url: 'https://analysiscenter.veracode.com/'
  }
  const req = {
    getAppList: {
      name: 'getApplication',
      path: '/appsec/v1/applications',
      host: 'api.veracode.com',
      method: 'GET'
    },
    getApplication: {
      name: 'getApplication',
      path: `/appsec/v1/applications/${appId}`,
      host: 'api.veracode.com',
      method: 'GET'
    },
    getBuildList: {
      name: 'getBuildList',
      path: `/api/5.0/getbuildlist.do?app_id=${lagacyId}`,
      host: 'analysiscenter.veracode.com',
      method: 'GET'
    },
    getSummaryreport: {
      name: 'getSummaryreport',
      path: '/api/4.0/summaryreport.do?build_id=',
      host: 'analysiscenter.veracode.com',
      method: 'GET'
    }
  }
  try {
    // const application  = await request(req.getApplication);
    const builds = await request(req.getBuildList)
    const buildsJs = convert.xml2js(builds, { compact: true, spaces: 4, ignoreDeclaration: true })
    console.log(buildsJs)
    const build = buildsJs.buildlist.build.filter(build => {
      return build._attributes.version.indexOf('3190682e') > -1
    })
    if (build.length === 1) {
      console.log({ build: build[0] })
      const reportReq = { ...req.getSummaryreport, path: `${req.getSummaryreport.path}${build[0]._attributes.build_id}` }
      const report = await request(reportReq)

      const reportJs = convert.xml2js(report, { compact: true, spaces: 4, ignoreDeclaration: true })
      const reportSummary = reportJs.summaryreport._attributes
      // https://analysiscenter.veracode.com/auth/index.jsp#ViewReportsDetailedReport:74838:791009:8005648:7983204:7998267:::::2084879
      console.log({ summaryReport: reportSummary })
      // const sandboxId = reportSummary.sandbox_id
      const appName = reportSummary.app_name
      // console.log({
      //     policy_name:reportJs.summaryreport._attributes.policy_name,
      //     policy_compliance_status: reportJs.summaryreport._attributes.policy_compliance_status
      // })
      console.log({ 'static-analysis': reportJs.summaryreport['static-analysis'] })
      // console.log({severity:reportJs.summaryreport.severity});
      // console.log({"flaw-status":reportJs.summaryreport["flaw-status"]});
      let summaryHeading = `# Veracode Application: ${appName}`
      summaryHeading = `${summaryHeading}\n### Policy name: ${reportJs.summaryreport._attributes.policy_name}`
      summaryHeading = `${summaryHeading}\n### Compliance status: ${reportJs.summaryreport._attributes.policy_compliance_status}\n`

      const summary = parseSummary(reportJs.summaryreport.severity)
      // console.log(summary);
      check_run.output_summary = `${summaryHeading}${summary}`
      // TODO - update conclusion
      // TODO - add result image: https://analysiscenter.veracode.com/images/policy/icon-shield-0.png
      /*
            Inline-style:
            ![alt text](https://github.com/adam-p/markdown-here/raw/master/src/common/images/icon48.png "Logo Title Text 1")
            */
      check_run.conclusion = 'neutral'
      const reportDirect = `${reportSummary.account_id}:${reportSummary.app_id}:${reportSummary.build_id}:${reportSummary.analysis_id}:${reportSummary.static_analysis_unit_id}:::::${reportSummary.sandbox_id}`
      check_run.details_url = `https://analysiscenter.veracode.com/auth/index.jsp#ViewReportsDetailedReport:${reportDirect}`
    } else {
      console.log('No build found')
    }
  } catch (e) {
    console.log(e.message, e)
    check_run.conclusion = 'cancelled'
  }

  return check_run
}

const request = async (reqStruct) => {
  const header = this.generateHeader(reqStruct.host, reqStruct.path, reqStruct.method)

  const url = `https://${reqStruct.host}${reqStruct.path}`
  // console.log(url);
  const response = await axios.get(url, {
    headers: {
      Authorization: header
    }
  })
    .catch(error => {
      console.log(error.message)
      return error.response
    })

  console.log(response.data)
  return response.data
}

const parseSummary = (severities) => {
  let summary = 'Severity | Total \n --- | ---'
  severities.map(sev => {
    // console.log(sev._attributes);
    // console.log(sev.category);
    const sevName = number2severity(sev._attributes.level)
    let totalForSev = 0
    let subCat = ''
    if (sev.category !== undefined) {
      if (Array.isArray(sev.category)) {
        sev.category.map(cat => {
          subCat = subCat + '\n   ' + cat._attributes.categoryname + ' | ' + cat._attributes.count
          totalForSev = totalForSev + parseInt(cat._attributes.count)
        })
      } else {
        subCat = '\n   ' + sev.category._attributes.categoryname + ' | ' + sev.category._attributes.count
        totalForSev = parseInt(sev.category._attributes.count)
      }
    }
    summary = summary + '\n**' + sevName + '** | **' + totalForSev + '**' + subCat
  })

  return summary
}

const number2severity = (numStr) => {
  if (numStr === '5') {
    return 'Very High'
  } else if (numStr === '4') {
    return 'High'
  } else if (numStr === '3') {
    return 'Medium'
  } else if (numStr === '2') {
    return 'Low'
  } else if (numStr === '1') {
    return 'Very Low'
  } else if (numStr === '0') {
    return 'Informational'
  }
}
// TODO - finish this function and add to summary
const policyIconMd = (policyComplianceStatus) => {
  const iconPrefix = 'https://analysiscenter.veracode.com/images/policy/icon-shield' // -0.png'
  if (policyIcon === undefined || policyIcon === null || policyIcon.length < 4) {
    return ''
  } else if (policyComplianceStatus === 'Pass') {
    return `![alt text](${iconPrefix}-0.png)`
  }
}
