'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');

const {TextDecoder} = require('util');
const debug = require('debug')('MiBand');
const uuid = require('./uuid');
const textDecoder = new TextDecoder();


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

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


    static getServicesToDiscover() {

        return [
            uuid.UUID_SERVICE_MIBAND_1,
            uuid.UUID_SERVICE_MIBAND_2,
            uuid.UUID_SERVICE_HEART_RATE,
            uuid.UUID_SERVICE_IMMEDIATE_ALERT,
            uuid.UUID_SERVICE_DEVICE_INFORMATION
        ];
    }

    static getCharacteristicsToDiscover() {

        return [
            uuid.UUID_CHAR_AUTH,
            uuid.UUID_CHAR_EVENT, uuid.UUID_CHAR_HRM_CTRL,
            uuid.UUID_CHAR_HRM_DATA,
            uuid.UUID_CHAR_USER,
            uuid.UUID_CHAR_ALERT_DATA,
            uuid.UUID_CHAR_BATT,
            uuid.UUID_CHAR_STEPS,
            uuid.UUID_CHAR_DEVICE_INFO_SW,
            uuid.UUID_CHAR_DEVICE_INFO_HW,
            uuid.UUID_CHAR_DEVICE_INFO_SERIAL,
            uuid.UUID_CHAR_TIME

        ];
    }

    constructor(peripheral) {
        super();
        this.device = peripheral;
        this.key = new Buffer(this.device.id, 'hex');

    }

    async discoverCharacteristics() {
        const {characteristics} = await new Promise((resolve, reject) => this.device.discoverSomeServicesAndCharacteristics(
            MiBand.getServicesToDiscover(),
            MiBand.getCharacteristicsToDiscover(),
            (error, services, characteristics) => error ? reject(error) : resolve({services, characteristics})
        ));
        this.characteristics = {
            auth: this.getCharacteristic(characteristics, uuid.UUID_CHAR_AUTH),
            event: this.getCharacteristic(characteristics, uuid.UUID_CHAR_EVENT),
            heartRateControl: this.getCharacteristic(characteristics, uuid.UUID_CHAR_HRM_CTRL),
            heartRateData: this.getCharacteristic(characteristics, uuid.UUID_CHAR_HRM_DATA),
            user: this.getCharacteristic(characteristics, uuid.UUID_CHAR_USER),
            alert: this.getCharacteristic(characteristics, uuid.UUID_CHAR_ALERT_DATA),
            battery: this.getCharacteristic(characteristics, uuid.UUID_CHAR_BATT),
            steps: this.getCharacteristic(characteristics, uuid.UUID_CHAR_STEPS),
            sw: this.getCharacteristic(characteristics, uuid.UUID_CHAR_DEVICE_INFO_SW),
            hw: this.getCharacteristic(characteristics, uuid.UUID_CHAR_DEVICE_INFO_HW),
            serial: this.getCharacteristic(characteristics, uuid.UUID_CHAR_DEVICE_INFO_SERIAL),
            time: this.getCharacteristic(characteristics, uuid.UUID_CHAR_TIME)

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
        console.log('startNotificationsFor HRM_CONTROL');
        await this.startNotificationsFor(this.characteristics.event);
        console.log('startNotificationsFor EVENT');
        // await this.startNotificationsFor(uuid.UUID_CHAR_RAW_DATA);
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
        return writeValueToChar(this.characteristics.auth, new Buffer([0x02, 0x08]))
    }

    authSendNewKey(key) {
        return writeValueToChar(this.characteristics.auth, Buffer.concat([new Buffer([0x01, 0x08]), key]));
    }

    authSendEncKey(encrypted) {
        return writeValueToChar(this.characteristics.auth, Buffer.concat([new Buffer([0x03, 0x08]), encrypted]));
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
     * Notifications*/
    async showNotification(type = 'message') {
        debug('Notification:', type);
        switch (type) {
            case 'message':
                writeValueToChar(this.characteristics.alert, new Buffer([0x01]));
                break;
            case 'phone':
                writeValueToChar(this.characteristics.alert, new Buffer([0x02]));
                break;
            case 'vibrate':
                writeValueToChar(this.characteristics.alert, new Buffer([0x03]));
                break;
            case 'off':
                writeValueToChar(this.characteristics.alert, new Buffer([0x00]));
                break;
            default:
                throw new Error('Unrecognized notification type');
        }
    }

    /*
     * Heart Rate Monitor
     */

    async hrmRead() {

        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x00]));
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x00]));
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x01]));
        return new Promise((resolve, reject) => {
            setTimeout(() => reject('hrmRead Timeout'), 30000);
            this.once('heart_rate', resolve);
        });
    }

    async hrmStart() {
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x02, 0x00]));
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x00]));
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x01]));

        // Start pinging HRM
        this.hrmTimer = this.hrmTimer || setInterval(() => {
            console.log('Pinging HRM');
            writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x16]));
        }, 12000);
    }

    async hrmStop() {
        clearInterval(this.hrmTimer);
        this.hrmTimer = undefined;
        await writeValueToChar(this.characteristics.heartRateControl, new Buffer([0x15, 0x01, 0x00]));
    }

    /*
     * Pedometer
     */

    async getPedometerStats() {
        let data = await readValueFromChar(this.characteristics.steps);
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
        let data = await readValueFromChar(this.characteristics.battery);
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
        let data = await readValueFromChar(this.characteristics.time);
        data = Buffer.from(data.buffer);
        return parseDate(data)
    }

    async getSerial() {
        if (!this.characteristics.serial) return undefined;
        let data = await readValueFromChar(this.characteristics.serial);
        return textDecoder.decode(data)
    }

    async getHwRevision() {

        let data = await readValueFromChar(this.characteristics.hw);
        data = textDecoder.decode(data);
        if (data.startsWith('V') || data.startsWith('v'))
            data = data.substring(1);
        return data
    }

    async getSwRevision() {
        let data = await readValueFromChar(this.characteristics.sw);
        data = textDecoder.decode(data);
        if (data.startsWith('V') || data.startsWith('v'))
            data = data.substring(1);
        return data
    }

    async setUserInfo(user) {
        let data = new Buffer(16);
        data.writeUInt8(0x4f, 0); // Set user info command

        data.writeUInt16LE(user.born.getFullYear(), 3);
        data.writeUInt8(user.born.getMonth() + 1, 5);
        data.writeUInt8(user.born.getDate(), 6);
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
        data.writeUInt16LE(user.height, 8); // cm
        data.writeUInt16LE(user.weight, 10); // kg
        data.writeUInt32LE(user.id, 12); // id

        await writeValueToChar(this.characteristics.user, new Buffer(data));
    }

    //async reboot() {
    //  await this.char.fw_ctrl.writeValue(AB([0x05]))
    //}

    /*
     * RAW data
     */
    /*        async rawStart() {
                await this.char.raw_ctrl.writeValue(AB([0x01, 0x03, 0x19]))
                await this.hrmStart();
                await this.char.raw_ctrl.writeValue(AB([0x02]))
            }

            async rawStop() {
                await this.char.raw_ctrl.writeValue(AB([0x03]))
                await this.hrmStop();
            }*/

    /*
     * Internals
     */

    handleNotify(charUID, event) {
        const value = new Buffer(event);

        if (charUID === uuid.UUID_CHAR_AUTH) {
            const cmd = value.slice(0, 3).toString('hex');
            if (cmd === '100101') {         // Set New Key OK
                this.authReqRandomKey()
            } else if (cmd === '100201') {  // Req Random Number OK
                let rdn = value.slice(3);
                let cipher = crypto.createCipheriv('aes-128-ecb', this.key, '').setAutoPadding(false);
                let encrypted = Buffer.concat([cipher.update(rdn), cipher.final()]);
                this.authSendEncKey(encrypted)
            } else if (cmd === '100301') {
                debug('Authenticated');
                this.emit('authenticated')

            } else if (cmd === '100104') {  // Set New Key FAIL
                this.emit('error', 'Key Sending failed')
            } else if (cmd === '100204') {  // Req Random Number FAIL
                this.emit('error', 'Key Sending failed')
            } else if (cmd === '100304') {
                debug('Encryption Key Auth Fail, sending new key...');
                this.authSendNewKey(this.key)
            } else {
                debug('Unhandled auth rsp:', value);
            }

        } else if (charUID === uuid.UUID_CHAR_HRM_DATA) {
            let rate = value.readUInt16BE(0);
            this.emit('heart_rate', rate)

        } else if (charUID === uuid.UUID_CHAR_EVENT) {
            const cmd = value.toString('hex');
            if (cmd === '04') {
                this.emit('button')
            } else {
                debug('Unhandled event:', value);
            }
        } else if (charUID === uuid.UUID_CHAR_RAW_DATA) {
            // TODO: parse adxl362 data
            // https://github.com/Freeyourgadget/Gadgetbridge/issues/63#issuecomment-302815121
            debug('RAW data:', value)
        } else {
            debug(event.target.uuid, '=>', value)
        }
    }

    getCharacteristic(characteristics, characteristicUUID) {
        const characteristic = characteristics.find(({uuid}) => uuid === characteristicUUID);
        if (!characteristic) {
            console.warn(`Characteristic with UUID ${characteristicUUID} was not found`);
        }

        return characteristic;
    }
}

module.exports = MiBand;

function readValueFromChar(char) {

  return new Promise((resolve, reject) => char.read((err, data) => err ? reject(err) : resolve(data)));
}

function writeValueToChar(char, value) {

  return new Promise((resolve, reject) => char.write(value, true, (err, data) => err ? reject(err) : resolve(data)));
}