const path = require('path')

const commerce = function (configOptions) {
  const options = { ...this.options.commerce, ...configOptions, corePath: path.resolve(__dirname, 'core.js') }

  const requiredParams = ['platform', 'config']
  const missingParams = requiredParams.reduce((acc, param) => {
    if (options[param]) return acc
    return [...acc, param]
  }, [])

  if (missingParams.length) {
    console.error('Missing parameters in Commerce Module:', missingParams.join(', '))
    return
  }

  this.addPlugin({
    src: path.resolve(__dirname, `platforms/${options.platform}/index.js`),
    options,
  })
}

module.exports = commerce
module.exports.meta = require('../../package.json')
