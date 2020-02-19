const express = require('express')
const router = express.Router()
const { User, Setting } = require('../models/index')
const _ = require('lodash')
const Speakeasy = require('speakeasy')
const QRCode = require('qrcode')

/* GET users listing. */
router.get('/', async (req, res, next) => {
  const showUsers = await Setting.findOne({ where: { key: 'show_usernames' } })
  if (!showUsers || showUsers.value !== 'yes') {
    return res.json({
      status: 'ok',
      result: null
    })
  }

  const users = await User.findAll()

  if (!users.length) {
    return res.json({
      status: 'ok',
      result: []
    })
  }

  return res.json({
    status: 'ok',
    result: users.map(user => ({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      publicPage: _.get(user.options, 'publicPage', false)
    }))
  })
})

router.post('/', async (req, res, next) => {
  const usersCount = await User.count()

  // Do we want to prevent user registration unless logged in?
  if (usersCount !== 0 && !req.user) {
    return res.status(403).json({
      status: 'error',
      result: 'unauthorized'
    })
  }

  if (usersCount > 0 && req.user.level !== User.ADMIN) {
    delete req.body.level
  }

  const existing = await User.findOne({
    where: {
      email: req.body.email
    }
  })

  if (existing) {
    return res.status(400).json({
      stattus: 'error',
      result: 'email_exists'
    })
  }

  const user = await User.create(req.body)

  return res.json({
    status: 'ok',
    result: user.toJSON()
  })
})

router.put('/', async (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({
      status: 'error',
      result: 'unauthorized'
    })
  }

  // Only admins can alter user levels
  if (req.user.level !== User.ADMIN) {
    delete req.body.level
  }

  if (req.body.currentPassword) {
    if (!req.user.verifyPassword(req.body.currentPassword)) {
      return res.status(400).json({
        status: 'error',
        result: 'incorrect_password'
      })
    }
  } else {
    // If we didn't pass up the current password, don't submit a new password
    delete req.body.password
  }

  // ALWAYS DELETE totp, this should only be set by the server
  delete req.body.totpSecret

  // Begin process to set up and confirm multi-factor authentication
  if (req.user.multifactorEnabled === false && req.body.multifactorEnabled === true) {
    if (!req.user.totpSecret) {
      const secret = Speakeasy.generateSecret()
      const qrcode = await QRCode.toDataURL(secret.otpauth_url)

      req.user.update({
        totp: secret.base32
      })

      return res.json({
        status: 'confirm totp',
        qrcode: qrcode
      })
    } else if (req.body.totp) {
      if (Speakeasy.totp.verify({
        secret: req.user.totpSecret,
        encoding: 'base32',
        token: req.body.totp,
        window: 0
      })) {
        req.user.update({ multifactorEnabled: true })

        return res.json({
          status: 'ok'
        })
      }
    }
  } else if (req.user.multifactorEnabled === true && req.body.multifactorEnabled === false) {
    req.user.update({
      multifactorEnabled: false,
      totpSecret: null
    })
  }

  return res.json({
    status: 'ok'
  })
})

module.exports = router
