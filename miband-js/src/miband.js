'use strict';

const EventEmitter = require('events');
const crypto = require('browserify-aes');
const {TextDecoder} = require('util');
const debug = require('debug')('MiBand');

const UUID_BASE = (x) => `0000${x}0000351221180009af100700`;

const UUID_SERVICE_GENERIC_ACCESS = '1800';
const UUID_SERVICE_GENERIC_ATTRIBUTE = '1801';
const UUID_SERVICE_DEVICE_INFORMATION = '180a';
const UUID_SERVICE_FIRMWARE = UUID_BASE('1530');
const UUID_SERVICE_ALERT_NOTIFICATION = '1811';
const UUID_SERVICE_IMMEDIATE_ALERT = '1802';
const UUID_SERVICE_HEART_RATE = '180d';
const UUID_SERVICE_MIBAND_1 = 'fee0';
const UUID_SERVICE_MIBAND_2 = 'fee1';

const COMMAND_START_HR_MANUAL = [0x15, 0x02, 0x01];
const COMMAND_STOP_HR_MANUAL = [0x15, 0x02, 0x00];
const COMMAND_START_HR_CONTINIOUS = [0x15, 0x01, 0x01];
const COMMAND_STOP_HR_CONTINIOUS = [0x15, 0x01, 0x00];

const UUID_CHAR_TIME = '2a2b';
const UUID_CHAR_AUTH = UUID_BASE('0009');
const UUID_CHAR_RAW_CTRL = UUID_BASE('0001');
const UUID_CHAR_RAW_DATA = UUID_BASE('0002');
const UUID_CHAR_CONFIG = UUID_BASE('0003');
const UUID_CHAR_ACTIVE = UUID_BASE('0005');
const UUID_CHAR_BATT = UUID_BASE('0006');
const UUID_CHAR_STEPS = UUID_BASE('0007');
const UUID_CHAR_USER = UUID_BASE('0008');
const UUID_CHAR_EVENT = UUID_BASE('0010');
const UUID_CHAR_HRM_CTRL = '2a39';
const UUID_CHAR_HRM_DATA = '2a37';
const UUID_CHAR_ALERT_DATA = '2a06';
const UUID_CHAR_DEVICE_INFO_HW = '2a27';
const UUID_CHAR_DEVICE_INFO_SW = '2a28';
const UUID_CHAR_DEVICE_INFO_SERIAL = '2a25';
const UUID_CHAR_FW_CTRL = UUID_BASE('1531');
const UUID_CHAR_FW_DATA = UUID_BASE('1532');


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// This is a helper function that constructs an ArrayBuffer based on arguments
const AB = function () {
  let args = [...arguments];

  // Convert all arrays to buffers
  args = args.map(function (i) {
    if (i instanceof Array) {
      return Buffer.from(i);
    }
    return i;
  });

  // Merge into a single buffer
  let buf = Buffer.concat(args);

  // // Convert into ArrayBuffer
  // let ab = new ArrayBuffer(buf.length);
  // let view = new Uint8Array(ab);
  // for (let i = 0; i < buf.length; ++i) {
  //   view[i] = buf[i];
  // }
  return buf;
};

function parseDate(buff) {
  let year = buff.readUInt16LE(0),
    mon = buff[2] - 1,
    day = buff[3],
    hrs = buff[4],
    min = buff[5],
    sec = buff[6],
    msec = buff[8] * 1000 / 256;
  return new Date(year, mon, day, hrs, min, sec)
}

class MiBand extends EventEmitter {

  static get advertisementService() {
    return 0xFEE0;
  }

  static get optionalServices() {
    return [
      UUID_SERVICE_GENERIC_ACCESS,
      UUID_SERVICE_GENERIC_ATTRIBUTE,
      UUID_SERVICE_DEVICE_INFORMATION,
      UUID_SERVICE_FIRMWARE,
      UUID_SERVICE_ALERT_NOTIFICATION,
      UUID_SERVICE_IMMEDIATE_ALERT,
      UUID_SERVICE_HEART_RATE,
      UUID_SERVICE_MIBAND_1,
      UUID_SERVICE_MIBAND_2,
    ]
  }

  static getServicesToDiscover() {

    return [UUID_SERVICE_MIBAND_1, UUID_SERVICE_MIBAND_2, UUID_SERVICE_HEART_RATE];
  }

  static getCharacteristicsToDiscover() {

    return [UUID_CHAR_AUTH, UUID_CHAR_EVENT, UUID_CHAR_HRM_CTRL, UUID_CHAR_HRM_DATA];
  }

  constructor(peripheral) {
    super();
    this.device = peripheral;
    // TODO: this is constant for now, but should random and managed per-device
    this.key = new Buffer('30313233343536373839404142434445', 'hex');
    this.textDec = new TextDecoder();
    this.characteristics = {
      auth: this.getCharacteristic(UUID_SERVICE_MIBAND_2, UUID_CHAR_AUTH),
      event: this.getCharacteristic(UUID_SERVICE_MIBAND_1, UUID_CHAR_EVENT),
      heartRateControl: this.getCharacteristic(UUID_SERVICE_HEART_RATE, UUID_CHAR_HRM_CTRL),
      heartRateData: this.getCharacteristic(UUID_SERVICE_HEART_RATE, UUID_CHAR_HRM_DATA),
    };

  }

  async startNotificationsFor(char) {
    char.on('data', this.handleNotify.bind(this, char.uuid));
    char.subscribe(err => err && console.error('start notif', err));
  }

  async init() {
    await this.startNotificationsFor(this.characteristics.auth);
    console.log('startNotificationsFor AUTH');
    await delay(1000);
    await this.authenticate();
    console.log('authenticate');
    await this.startNotificationsFor(this.characteristics.heartRateData);
    console.log('startNotificationsFor HRM_DATA');
    await this.startNotificationsFor(this.characteristics.heartRateControl);
    // console.log('startNotificationsFor EVENT');
    // await this.startNotificationsFor(UUID_CHAR_RAW_DATA);
    // console.log('startNotificationsFor RAW_DATA');
  }

  /*
   * Authentication
   */

  async authenticate() {
    let promise = new Promise((resolve, reject) => {
      setTimeout(() => reject('authenticate Timeout'), 30000);
      this.once('authenticated', resolve);
    });
    await this.authReqRandomKey();
    return promise;
  }

  authReqRandomKey() {
    return writeValueFromChar(this.characteristics.auth, AB([0x02, 0x08]))
  }

  authSendNewKey(key) {
    return writeValueFromChar(this.characteristics.auth, AB([0x01, 0x08], key))
  }

  authSendEncKey(encrypted) {
    return writeValueFromChar(this.characteristics.auth, AB([0x03, 0x08], encrypted))
  }

  /*
   * Button
   */

  waitButton(timeout = 30000) {
    return new Promise((resolve, reject) => {
      setTimeout(() => reject('waitButton Timeout'), timeout);
      this.once('button', resolve);
    });
  }

  /*
   * Notifications
async showNotification(type = 'message') {
    debug('Notification:', type);
    switch (type) {
      case 'message':
        writeValueFromChar(this.device.char[UUID_SERVICE_ALERT_DATA], new Buffer([0x01]));
        break;
      case 'phone':
        writeValueFromChar(this.device.char[UUID_SERVICE_ALERT_DATA], new Buffer([0x02]));
        break;
      case 'vibrate':
        writeValueFromChar(this.device.char[UUID_SERVICE_ALERT_DATA], new Buffer([0x03]));
        break;
      case 'off':
        writeValueFromChar(this.device.char[UUID_SERVICE_ALERT_DATA], new Buffer([0x00]));
        break;
      default:
        throw new Error('Unrecognized notification type');
    }
  }

  /*
   * Heart Rate Monitor
   */

  async hrmRead() {

    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x00]));
    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x00]));
    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x01]));
    return new Promise((resolve, reject) => {
      setTimeout(() => reject('hrmRead Timeout'), 30000);
      this.once('heart_rate', resolve);
    });
  }

  async hrmStart() {
    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x00]));
    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x00]));
    await writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x01]));

    // Start pinging HRM
    this.hrmTimer = this.hrmTimer || setInterval(() => {
      debug('Pinging HRM');
      writeValueFromChar(this.characteristics.heartRateControl, new Buffer([0x16]));
    }, 12000);
  }

  async hrmStop() {
    clearInterval(this.hrmTimer);
    this.hrmTimer = undefined;
    await this.char.hrm_ctrl.writeValue(AB([0x15, 0x01, 0x00]))
  }

  /*
   * Pedometer
   */

  async getPedometerStats() {
    let data = await readValueFromChar(this.device.char[UUID_CHAR_STEPS]);
    data = Buffer.from(data.buffer);
    let result = {};
    //unknown = data.readUInt8(0)
    result.steps = data.readUInt16LE(1);
    //unknown = data.readUInt16LE(3) // 2 more bytes for steps? ;)
    if (data.length >= 8) result.distance = data.readUInt32LE(5);
    if (data.length >= 12) result.calories = data.readUInt32LE(9);
    return result;
  }

  /*
   * General functions
   */

  async getBatteryInfo() {
    await delay();
    let data = await readValueFromChar(this.device.char[UUID_CHAR_BATT]);
    data = Buffer.from(data.buffer);
    if (data.length <= 2) return 'unknown';

    let result = {};
    result.level = data[1];
    result.charging = !!data[2];
    result.off_date = parseDate(data.slice(3, 10));
    result.charge_date = parseDate(data.slice(11, 18));
    //result.charge_num = data[10];
    result.charge_level = data[19];
    return result;
  }

  async getTime() {
    await delay();
    let data = await readValueFromChar(this.device.char[UUID_CHAR_TIME]);
    data = Buffer.from(data.buffer);
    return parseDate(data)
  }

  async getSerial() {
    if (!this.device.char[UUID_CHAR_DEVICE_INFO_SERIAL]) return undefined;
    let data = await readValueFromChar(this.device.char[UUID_CHAR_DEVICE_INFO_SERIAL]);
    return this.textDec.decode(data)
  }

  async getHwRevision() {

    let data = await readValueFromChar(this.device.char[UUID_CHAR_DEVICE_INFO_HW]);
    data = this.textDec.decode(data);
    if (data.startsWith('V') || data.startsWith('v'))
      data = data.substring(1);
    return data
  }

  async getSwRevision() {
    let data = await readValueFromChar(this.device.char[UUID_CHAR_DEVICE_INFO_SW]);
    data = this.textDec.decode(data);
    if (data.startsWith('V') || data.startsWith('v'))
      data = data.substring(1);
    return data
  }

  async setUserInfo(user) {
    let data = new Buffer(16)
    data.writeUInt8(0x4f, 0) // Set user info command

    data.writeUInt16LE(user.born.getFullYear(), 3)
    data.writeUInt8(user.born.getMonth() + 1, 5)
    data.writeUInt8(user.born.getDate(), 6)
    switch (user.sex) {
      case 'male':
        data.writeUInt8(0, 7);
        break;
      case 'female':
        data.writeUInt8(1, 7);
        break;
      default:
        data.writeUInt8(2, 7);
        break;
    }
    data.writeUInt16LE(user.height, 8) // cm
    data.writeUInt16LE(user.weight, 10) // kg
    data.writeUInt32LE(user.id, 12) // id

    await this.char.user.writeValue(AB(data))
  }

  //async reboot() {
  //  await this.char.fw_ctrl.writeValue(AB([0x05]))
  //}

  /*
   * RAW data
   */

  async rawStart() {
    await this.char.raw_ctrl.writeValue(AB([0x01, 0x03, 0x19]))
    await this.hrmStart();
    await this.char.raw_ctrl.writeValue(AB([0x02]))
  }

  async rawStop() {
    await this.char.raw_ctrl.writeValue(AB([0x03]))
    await this.hrmStop();
  }

  /*
   * Internals
   */

  handleNotify(charUID, event) {
    const value = new Buffer(event);

    if (charUID === UUID_CHAR_AUTH) {
      const cmd = value.slice(0, 3).toString('hex');
      if (cmd === '100101') {         // Set New Key OK
        this.authReqRandomKey()
      } else if (cmd === '100201') {  // Req Random Number OK
        let rdn = value.slice(3);
        let cipher = crypto.createCipheriv('aes-128-ecb', this.key, '').setAutoPadding(false)
        let encrypted = Buffer.concat([cipher.update(rdn), cipher.final()])
        this.authSendEncKey(encrypted)
      } else if (cmd === '100301') {
        debug('Authenticated');
        this.emit('authenticated')

      } else if (cmd === '100104') {  // Set New Key FAIL
        this.emit('error', 'Key Sending failed')
      } else if (cmd === '100204') {  // Req Random Number FAIL
        this.emit('error', 'Key Sending failed')
      } else if (cmd === '100304') {
        debug('Encryption Key Auth Fail, sending new key...')
        this.authSendNewKey(this.key)
      } else {
        debug('Unhandled auth rsp:', value);
      }

    } else if (charUID === UUID_CHAR_HRM_DATA) {
      let rate = value.readUInt16BE(0);
      this.emit('heart_rate', rate)

    } else if (charUID === UUID_CHAR_EVENT) {
      const cmd = value.toString('hex');
      if (cmd === '04') {
        this.emit('button')
      } else {
        debug('Unhandled event:', value);
      }
    } else if (charUID === UUID_CHAR_RAW_DATA) {
      // TODO: parse adxl362 data
      // https://github.com/Freeyourgadget/Gadgetbridge/issues/63#issuecomment-302815121
      debug('RAW data:', value)
    } else {
      debug(event.target.uuid, '=>', value)
    }
  }

  getCharacteristic(serviceUUID, characteristicUUID) {
    const service = this.device.services.find(({uuid}) => uuid === serviceUUID);
    if (!service) {
      console.warn(`Service with UUID ${serviceUUID} was not found`);
      return service;
    }
    const characteristic = service.characteristics.find(({uuid}) => uuid === characteristicUUID);
    if (!characteristic) {
      console.warn(`Characteristic with UUID ${serviceUUID} was not found`);
    }

    return characteristic;
  }
}

module.exports = MiBand;

function readValueFromChar(char) {
  return new Promise((resolve, reject) => {
    char.read((err, data) => {
      err ? reject(err) : resolve(data);
    })
  });
}

function writeValueFromChar(char, value) {
  return new Promise((resolve, reject) => {
    char.write(value, true, function (err, data) {
      err && console.error(err);
      err ? reject(err) : resolve(data);
    });
  });
}