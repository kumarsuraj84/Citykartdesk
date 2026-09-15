'use strict'
// Windows has no getxattr/setxattr syscalls (fs-xattr's native binding only
// targets linux/darwin, and no amount of build-tool installation changes that).
// This shim gives Storage's file backend the same functional guarantee —
// content-type/cache-control survive per-file — by keeping them in a JSON
// sidecar next to the real file instead of in a real extended attribute.
const fs = require('fs')

function sidecarPath(file) {
  return file + '.xattrs.json'
}

function readAll(file) {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(file), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function missingAttrError(attribute) {
  const err = new Error(`No such attribute: '${attribute}'`)
  err.code = 'ENOATTR'
  return err
}

function getAttributeSync(file, attribute) {
  const attrs = readAll(file)
  if (!Object.prototype.hasOwnProperty.call(attrs, attribute)) {
    throw missingAttrError(attribute)
  }
  return Buffer.from(attrs[attribute], 'utf8')
}

function setAttributeSync(file, attribute, value) {
  const attrs = readAll(file)
  attrs[attribute] = value.toString()
  fs.writeFileSync(sidecarPath(file), JSON.stringify(attrs))
}

function removeAttributeSync(file, attribute) {
  const attrs = readAll(file)
  if (!Object.prototype.hasOwnProperty.call(attrs, attribute)) {
    throw missingAttrError(attribute)
  }
  delete attrs[attribute]
  fs.writeFileSync(sidecarPath(file), JSON.stringify(attrs))
}

module.exports = { getAttributeSync, setAttributeSync, removeAttributeSync }
