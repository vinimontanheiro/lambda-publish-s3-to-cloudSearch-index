const AWS = require('aws-sdk')
const mammoth = require('mammoth')
const pdf = require('pdf-parse')

const API_VERSION = `2013-01-01`

const getPDFText = async (buffer) => {
  try {
    const text = (await pdf(buffer)).text
    return text;
  } catch (error) {
    console.log(`getPDFText error`, error)
  }
}

const getDOCXText = async (buffer) => {
  try {
    const text = (await mammoth.extractRawText({ buffer })).value
    return text
  } catch (error) {
    console.log(`getDOCXText error`, error)
  }
}

const removeInvalidCharacters = (str) => str.replace(/[^0-9a-zA-Z/._-]/g, '')

const decodeURISpaces = (str) => decodeURI(str).replace(/\+/g, ' ')

const isPDF = (str) => str.match(/\.pdf|\.PDF/g)

const isDOC = (str) => str.match(/\.docx|\.doc|\.DOCX|\.DOC/g)

const getJBatch = async ({ bucketname, filename, buffer }) => {
  const type = 'add';
  const id =  bucketname + ':' + filename;
  const fields = {
    content_type: 'text/plain',
    resourcename: filename,
    created: new Date(),
  };

  if (isPDF(filename)) {
    const content = await getPDFText(buffer);
    return [
      {
        type,
        id,
        fields: {
          content,
          ...fields
        },
      },
    ];
  }
  if (isDOC(filename)) {
    const content = await getDOCXText(buffer);
    return [
      {
        type,
        id,
        fields: {
          content,
          ...fields
        },
      },
    ];
  }
  const content = buffer.toString('utf-8');
  return [
    {
      type,
      id,
      fields: {
        content,
        ...fields
      },
    },
  ];
}

const addToCS = async ({ bucketname, filename, buffer, region, endpoint }) => {
  try {
    console.log(`Starting CS upload to endpoint: `, endpoint)

    const csd = new AWS.CloudSearchDomain({
      endpoint,
      region,
      apiVersion: API_VERSION,
    })

    const jbatch = await getJBatch({filename, bucketname, buffer});

    const params = {
      contentType: 'application/json',
      documents: JSON.stringify(jbatch),
    }

    const result = await csd.uploadDocuments(params).promise()
    console.log('CS upload successfully!')
    console.log(result)
  } catch (error) {
    console.log('CS upload file error >>> ', error)
  }
}

const deleteFromCSIndex = async ({
  bucketname,
  filename,
  region,
  endpoint,
}) => {
  try {
    console.log(`Starting CS file delete from endpoint: `, endpoint)

    const csd = new AWS.CloudSearchDomain({
      endpoint,
      region,
      apiVersion: API_VERSION,
    })

    const jbatch = [
      {
        type: 'delete',
        id: bucketname + ':' + filename,
      },
    ]

    const params = {
      contentType: 'application/json',
      documents: JSON.stringify(jbatch),
    }
    const result = await csd.uploadDocuments(params).promise()
    console.log('CS file deleted successfully!')
    console.log(result)
  } catch (error) {
    console.log('CS delete file error >>> ', error)
  }
}

exports.handler = async (event) => {
  try {
    const isDelete = !!event.Records[0].eventName.match(/Delete|delete/)

    console.log(
      `Starting free-jurisprudence-doc-indexer method: ${
        isDelete ? 'delete' : 'add'
      }`
    )

    const region = process.env.REGION
    const configurationId = event.Records[0].s3.configurationId
    const endpoint = `${configurationId}.${region}.cloudsearch.amazonaws.com`
    const filename = decodeURISpaces(event.Records[0].s3.object.key)
    const bucketname = event.Records[0].s3.bucket.name

    if (!isDelete) {
      console.log(`Getting S3 file ${filename} from ${bucketname} ...`)

      const params = {
        Bucket: bucketname,
        Key: filename,
        RequestPayer: 'requester',
      }
      const s3 = new AWS.S3({
        region,
      })
      const buffer = (await s3.getObject(params).promise()).Body

      await addToCS({
        bucketname,
        filename: removeInvalidCharacters(filename),
        buffer,
        region,
        endpoint,
      })
    } else {
      await deleteFromCSIndex({
        bucketname,
        filename: removeInvalidCharacters(filename),
        region,
        endpoint,
      })
    }
  } catch (error) {
    console.log('Handler started with errors >>> ', error)
  }
}