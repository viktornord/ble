const util = require('util');
const path = require('path');
const Noble = require('noble/lib/noble');
const bindings = require('noble/lib/resolve-bindings')();
const noble = new Noble(bindings);
const MiBand = require('./miband');

require('dotenv').config({path: path.resolve(__dirname, '.env')});
const {DEVICE_ADDRESS} = process.env;

let peripheralMiBand, miband;

function delay(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const log = console.log;

noble.on('stateChange', function (state) {
    if (state === 'poweredOn' && (!peripheralMiBand || !(['connected', 'connecting'].includes(peripheralMiBand.state)))) {
        noble.startScanning();
    } else {
        noble.stopScanning();
    }
});


async function init(miband) {
    await delay();
    await miband.init();
    let info = {
        time: await miband.getTime(),
        battery: await miband.getBatteryInfo(),
        hw_ver: await miband.getHwRevision(),
        sw_ver: await miband.getSwRevision(),
        serial: miband.serialNumber,
    };

    log(`HW ver: ${info.hw_ver}  SW ver: ${info.sw_ver}`);
    log(`Battery: ${info.battery.level}%`);
    log(`Time: ${info.time.toLocaleString()}`);
    log(`Serial ${info.serial}`);
    //
    await delay();
    let ped = await miband.getPedometerStats();
    await delay();
    log('Pedometer:', JSON.stringify(ped));
    //
    // // log('Notifications demo...');
    // await miband.showNotification('message');
    // await delay(3000);
    // // await miband.showNotification('phone');
    // await delay(5000);
    // await miband.showNotification('off');
    //
    //log('Tap MiBand button, quick!');
    // miband.on('button', () => log('Tap detected'));
    // try {
    //     await miband.waitButton(10000)
    // } catch (e) {
    //     log('OK, nevermind ;)')
    // }
    await delay(3000);
    log('Heart Rate Monitor (single-shot)');
    log('Result:', await miband.hrmRead());
    await delay(5000);
    log('Heart Rate Monitor (continuous )...');
    miband.on('heart_rate', (rate) => {
        log('Heart Rate:', rate)
    });
    await miband.hrmStart();

//     log('RAW data (no decoding)...');
//     await miband.rawStart();
// /*    await delay(30000);
 //   await miband.rawStop();


}

noble.on('discover', async function (peripheral) {
    console.log('peripheral discovered (' + peripheral.id +
        ' with address <' + peripheral.address + ', ' + peripheral.addressType + '>,' +
        ' connectable ' + peripheral.connectable + ',' +
        ' RSSI ' + peripheral.rssi + ':' + 'local name: \t' + peripheral.advertisement.localName);
    if (peripheral.address && peripheral.address === DEVICE_ADDRESS) {
        noble.stopScanning();
        connect(peripheral);

    }
});
async function connect(peripheral) {
    try {
        peripheralMiBand = peripheral;
        await util.promisify(peripheral.connect.bind(peripheral))();
        peripheral.once('disconnect', async err => {
            log('disconnect');
            await miband.hrmStop();
            connect(peripheral);
        });
        miband = new MiBand(peripheral);
        await miband.discoverCharacteristics();
        await init(miband);

    }
    catch (error) {
        console.error(error);
    }
}

process.on('exit', code => {
    log('exit');
    if (miband) {
        miband.hrmStop();
    }
     noble.stopScanning();
    if (peripheralMiBand) peripheralMiBand.disconnect();
});