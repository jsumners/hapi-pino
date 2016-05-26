'use strict'

const Code = require('code')
const Lab = require('lab')
const split = require('split2')
const writeStream = require('flush-write-stream')

const lab = exports.lab = Lab.script()
const experiment = lab.experiment
const test = lab.test
const expect = Code.expect

const Hapi = require('hapi')
const Pino = require('.')

function getServer () {
  const server = new Hapi.Server()
  server.connection({ port: 3000 })
  return server
}

function sink (func) {
  var result = split(JSON.parse)
  result.pipe(writeStream.obj(func))
  return result
}

function registerWithSink (server, level, func, registered) {
  const stream = sink(func)
  const plugin = {
    register: Pino.register,
    options: {
      stream: stream,
      level: level
    }
  }

  server.register(plugin, registered)
}

function tagsWithSink (server, tags, func, registered) {
  const stream = sink(func)
  const plugin = {
    register: Pino.register,
    options: {
      stream: stream,
      level: 'trace',
      tags: tags
    }
  }

  server.register(plugin, registered)
}

function onHelloWorld (data) {
  expect(data.msg).to.equal('hello world')
}

function ltest (func) {
  ;['trace', 'debug', 'info', 'warn', 'error'].forEach((level) => {
    test(`at ${level}`, (done) => {
      func(level, done)
    })
  })
}

experiment('logs through the server.app.logger', () => {
  ltest((level, done) => {
    const server = getServer()
    registerWithSink(server, level, onHelloWorld, (err) => {
      expect(err).to.be.undefined()
      server.app.logger[level]('hello world')
      done()
    })
  })
})

experiment('logs through the server.logger()', () => {
  ltest((level, done) => {
    const server = getServer()
    registerWithSink(server, level, onHelloWorld, (err) => {
      expect(err).to.be.undefined()
      server.logger()[level]('hello world')
      done()
    })
  })
})

test('log on server start', (done) => {
  const server = getServer()
  registerWithSink(server, 'info', (data, enc, cb) => {
    expect(data).to.include(server.info)
    expect(data.msg).to.equal('server started')
    cb()
    done()
  }, (err) => {
    expect(err).to.be.undefined()
    server.start((err) => {
      expect(err).to.be.undefined()
    })
  })
})

experiment('logs each request', () => {
  test('at default level', (done) => {
    const server = getServer()
    registerWithSink(server, 'info', (data) => {
      expect(data.res.statusCode).to.equal(404)
      expect(data.req.id).to.exist()
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(0)
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('track responseTime', (done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => setTimeout(reply, 10, 'hello world')
    })
    registerWithSink(server, 'info', (data) => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.req.id).to.exist()
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(10)
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('correctly set the status code', (done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => reply('hello world')
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      cb()
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('handles 500s', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => reply(new Error('boom'))
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      if (count === 0) {
        expect(data.err.message).to.equal('boom')
        expect(data.level).to.equal(40)
        expect(data.msg).to.equal('request error')
      } else {
        expect(data.res.statusCode).to.equal(500)
        expect(data.level).to.equal(30)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('set the request logger', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => {
        req.logger.info('hello logger')
        reply('hello world')
      }
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      if (count === 0) {
        expect(data.msg).to.equal('hello logger')
      } else {
        expect(data.res.statusCode).to.equal(200)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })
})

experiment('logs through server.log', () => {
  ltest((level, done) => {
    const server = getServer()
    tagsWithSink(server, {
      aaa: 'info'
    }, (data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(30)
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.log(['aaa'], 'hello world')
    })
  })

  test('one log for multiple tags', (done) => {
    const server = getServer()
    tagsWithSink(server, {
      aaa: 'info',
      bbb: 'warn'
    }, (data) => {
      expect(data.data).to.equal('hello world')
      // first matching tag
      expect(data.level).to.equal(30)
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.log(['aaa', 'bbb'], 'hello world')
    })
  })

  test('explode with a wrong level', (done) => {
    const server = getServer()
    server.register({
      register: Pino.register,
      options: {
        tags: {
          bbb: 'not a level'
        }
      }
    }, (err) => {
      expect(err).to.be.error()
      done()
    })
  })

  test('with tag catchall', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(20)
      done()
    })
    const plugin = {
      register: Pino.register,
      options: {
        stream: stream,
        level: 'debug',
        allTags: 'debug'
      }
    }

    server.register(plugin, (err) => {
      expect(err).to.be.undefined()
      server.log(['something'], 'hello world')
    })
  })

  test('default tag catchall', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(30)
      done()
    })
    const plugin = {
      register: Pino.register,
      options: {
        stream: stream
      }
    }

    server.register(plugin, (err) => {
      expect(err).to.be.undefined()
      server.log(['something'], 'hello world')
    })
  })
})

experiment('logs through request.log', () => {
  ltest((level, done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => {
        req.log(['aaa'], 'hello logger')
        reply('hello world')
      }
    })
    tagsWithSink(server, {
      aaa: level
    }, (data, enc, cb) => {
      if (data.tags) {
        expect(data.data).to.equal('hello logger')
        done()
      }
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('uses default tag mapping', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(20)
      done()
    })
    const plugin = {
      register: Pino.register,
      options: {
        stream: stream,
        level: 'debug'
      }
    }

    server.register(plugin, (err) => {
      expect(err).to.be.undefined()
      server.log(['debug'], 'hello world')
    })
  })
})

experiment('uses a prior pino instance', () => {
  test('without pre-defined serializers', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(30)
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      register: Pino.register,
      options: {
        instance: logger
      }
    }

    server.register(plugin, (err) => {
      expect(err).to.be.undefined()
      server.log(['something'], 'hello world')
    })
  })

  test('with pre-defined serializers', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.msg).to.equal('hello world')
      expect(data.foo).to.exist()
      expect(data.foo.serializedFoo).to.exist()
      expect(data.foo.serializedFoo).to.equal('foo is bar')
      expect(data.level).to.equal(30)
      done()
    })
    const logger = require('pino')({
      serializers: {
        foo: (input) => {
          return { serializedFoo: `foo is ${input}` }
        }
      }
    }, stream)
    const plugin = {
      register: Pino.register,
      options: {
        instance: logger
      }
    }

    server.register(plugin, (err) => {
      expect(err).to.be.undefined()
      server.app.logger.info({foo: 'bar'}, 'hello world')
    })
  })
})
