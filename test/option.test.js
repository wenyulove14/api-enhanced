const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const createOption = require('../util/option')

describe('realIP precedence', () => {
  let savedEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    delete process.env.DEFAULT_REAL_IP
    delete process.env.ENABLE_RANDOM_CN_IP
  })

  afterEach(() => {
    for (const key of ['DEFAULT_REAL_IP', 'ENABLE_RANDOM_CN_IP']) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  // Execute the real request layer with a captured HTTP transport and no network.
  const requestHeaders = async (options) => {
    let headers
    const sandbox = {
      module: { exports: {} },
      console,
      global: {},
      Buffer,
      require: (id) => {
        if (['http', 'https', 'path', 'os', 'url'].includes(id))
          return require(id)
        if (id === 'fs') return { readFileSync: () => '' }
        if (id === 'axios') {
          return {
            default: async (settings) => {
              headers = settings.headers
              return { data: { code: 200 }, headers: {}, status: 200 }
            },
          }
        }
        if (id === 'crypto-js') {
          return { lib: { WordArray: { random: () => 'test' } } }
        }
        if (id === './config.json') return { APP_CONF: { encrypt: false } }
        if (id === './index') {
          return {
            cookieObjToString: () => '',
            toBoolean: Boolean,
          }
        }
        return {}
      },
    }
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, '../util/request.js'), 'utf8'),
      sandbox,
    )
    await sandbox.module.exports('/api/test', {}, { ...options, crypto: 'api' })
    return headers
  }

  for (const randomEnabled of ['true', 'false']) {
    it(`uses query realIP before the default (random=${randomEnabled})`, async () => {
      process.env.DEFAULT_REAL_IP = '203.0.113.10'
      process.env.ENABLE_RANDOM_CN_IP = randomEnabled
      const options = createOption({ realIP: '203.0.113.20' })
      const headers = await requestHeaders({ ...options, ip: '203.0.113.30' })
      assert.strictEqual(headers['X-Real-IP'], '203.0.113.20')
      assert.strictEqual(headers['X-Forwarded-For'], '203.0.113.20')
    })

    it(`uses DEFAULT_REAL_IP before the server IP (random=${randomEnabled})`, async () => {
      process.env.DEFAULT_REAL_IP = '203.0.113.10'
      process.env.ENABLE_RANDOM_CN_IP = randomEnabled
      const options = createOption({})
      assert.strictEqual(options.randomCNIP, randomEnabled === 'true')
      const headers = await requestHeaders({ ...options, ip: '203.0.113.30' })
      assert.strictEqual(headers['X-Real-IP'], '203.0.113.10')
      assert.strictEqual(headers['X-Forwarded-For'], '203.0.113.10')
    })
  }

  it('uses the default when query realIP is empty, even with randomCNIP=true', async () => {
    process.env.DEFAULT_REAL_IP = '203.0.113.10'
    const options = createOption({ realIP: '', randomCNIP: true })
    assert.strictEqual(options.randomCNIP, true)
    const headers = await requestHeaders({ ...options, ip: '203.0.113.30' })
    assert.strictEqual(headers['X-Real-IP'], '203.0.113.10')
  })

  it('preserves the server IP fallback when no fixed IP is configured', async () => {
    const options = createOption({})
    assert.strictEqual(options.realIP, '')
    const headers = await requestHeaders({ ...options, ip: '203.0.113.30' })
    assert.strictEqual(headers['X-Real-IP'], '203.0.113.30')
    assert.strictEqual(headers['X-Forwarded-For'], '203.0.113.30')
  })

  it('preserves randomCNIP opt-out and empty environment fallback', () => {
    process.env.DEFAULT_REAL_IP = ''
    process.env.ENABLE_RANDOM_CN_IP = 'true'
    assert.strictEqual(createOption({ randomCNIP: false }).randomCNIP, false)
    assert.strictEqual(createOption({ randomCNIP: 'false' }).randomCNIP, false)
    assert.strictEqual(createOption({}).realIP, '')
  })
})
