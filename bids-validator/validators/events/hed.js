const hedValidator = require('hed-validator')
const utils = require('../../utils')
const Issue = utils.issues.Issue

module.exports = function checkHedStrings(events, headers, jsonContents) {
  let issues = []
  // get all headers associated with task data
  const taskHeaders = headers.filter(header => {
    const file = header[0]
    return file.relativePath.includes('_task-')
  })

  return hedValidator.buildSchema().then(hedSchema => {
    // loop through headers with files that are tasks
    taskHeaders.forEach(taskHeader => {
      const file = taskHeader[0]

      // get the json sidecar dictionary associated with that nifti scan
      const potentialSidecars = utils.files.potentialLocations(
        file.relativePath.replace('.gz', '').replace('.nii', '.json'),
      )
      const mergedDictionary = utils.files.generateMergedSidecarDict(
        potentialSidecars,
        jsonContents,
      )
      const sidecarHedTags = {}

      for (const sidecarKey in mergedDictionary) {
        const sidecarValue = mergedDictionary[sidecarKey]
        if (sidecarValue.HED !== undefined) {
          sidecarHedTags[sidecarKey] = sidecarValue.HED
        }
      }

      // get the _events.tsv associated with this task scan
      const potentialEvents = utils.files.potentialLocations(
        file.relativePath.replace('.gz', '').replace('bold.nii', 'events.tsv'),
      )
      const associatedEvents = events.filter(
        event => potentialEvents.indexOf(event.path) > -1,
      )

      // loop through all events associated with this task scan
      for (const event of associatedEvents) {
        // get all non-empty rows
        const rows = event.contents
          .split('\n')
          .filter(row => !(!row || /^\s*$/.test(row)))

        const columnHeaders = rows[0].trim().split('\t')
        const hedColumnIndex = columnHeaders.indexOf('HED')
        const sidecarHedColumnIndices = {}
        for (const sidecarHedColumn in sidecarHedTags) {
          const sidecarHedColumnHeader = columnHeaders.indexOf(sidecarHedColumn)
          if (sidecarHedColumnHeader > -1) {
            sidecarHedColumnIndices[sidecarHedColumn] = sidecarHedColumnHeader
          }
        }
        if (hedColumnIndex === -1 && sidecarHedColumnIndices.length === 0) {
          continue
        }

        for (const row of rows.slice(1)) {
          // get the 'HED' field
          const rowCells = row.trim().split('\t')
          const hedStringParts = []
          if (rowCells[hedColumnIndex]) {
            hedStringParts.push(rowCells[hedColumnIndex])
          }
          for (const sidecarHedColumn in sidecarHedColumnIndices) {
            const sidecarHedIndex = sidecarHedColumnIndices[sidecarHedColumn]
            const sidecarHedKey = rowCells[sidecarHedIndex]
            if (sidecarHedKey) {
              const sidecarHedString =
                sidecarHedTags[sidecarHedColumn][sidecarHedKey]
              if (sidecarHedString !== undefined) {
                hedStringParts.push(sidecarHedString)
              } else {
                issues.push(
                  new Issue({
                    code: 112,
                    file: file,
                    evidence: sidecarHedKey,
                  }),
                )
              }
            }
          }

          if (hedStringParts.length === 0) {
            continue
          }
          const hedString = hedStringParts.join(',')

          const [isHedStringValid, hedIssues] = hedValidator.validateHedString(
            hedString,
            hedSchema,
            true,
          )
          if (!isHedStringValid) {
            const convertedIssues = convertHedIssuesToBidsIssues(
              hedIssues,
              file,
            )
            issues = issues.concat(convertedIssues)
          }
        }
      }
    })
    return issues
  })
}

function convertHedIssuesToBidsIssues(hedIssues, file) {
  const hedIssuesToBidsCodes = {
    invalidCharacter: 106,
    parentheses: 107,
    commaMissing: 108,
    capitalization: 109,
    duplicateTag: 110,
    tooManyTildes: 111,
  }

  const convertedIssues = []
  for (const hedIssue of hedIssues) {
    const bidsIssueCode = hedIssuesToBidsCodes[hedIssue.code]
    if (bidsIssueCode === undefined) {
      if (hedIssue.message.startsWith('WARNING')) {
        convertedIssues.push(
          new Issue({
            code: 105,
            file: file,
            evidence: hedIssue.message,
          }),
        )
      } else {
        convertedIssues.push(
          new Issue({
            code: 104,
            file: file,
            evidence: hedIssue.message,
          }),
        )
      }
    } else {
      convertedIssues.push(
        new Issue({
          code: bidsIssueCode,
          file: file,
          evidence: hedIssue.message,
        }),
      )
    }
  }

  return convertedIssues
}
