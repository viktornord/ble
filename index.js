const Noble = require('noble/lib/noble');
const bindings = require('noble/lib/resolve-bindings')();
const noble = new Noble(bindings);
const util = require('util');
const MiBand = require('./miband-js/src/miband');


function delay(ms = 1000) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const log = console.log;

noble.on('stateChange', function (state) {
    if (state === 'poweredOn') {
        noble.startScanning();
    } else {
        noble.stopScanning();
    }
});


async function init(device) {
    const miband = new MiBand(device);
    await delay();
    await miband.init();
  /*  await delay(3000);
    let info = {
        time: await miband.getTime(),
        battery: await miband.getBatteryInfo(),
//        hw_ver: await miband.getHwRevision(),
  //      sw_ver: await miband.getSwRevision(),
        // serial:   await miband.getSerial(),
    };

    log(`HW ver: ${info.hw_ver}  SW ver: ${info.sw_ver}`);
    log(`Battery: ${info.battery.level}%`);
    log(`Time: ${info.time.toLocaleString()}`);
    //
    await delay();
    let ped = await miband.getPedometerStats();
    await delay();
    log('Pedometer:', JSON.stringify(ped));
    //
    // log('Notifications demo...');
    await miband.showNotification('message');
    await delay(3000);
    // await miband.showNotification('phone');
    await delay(5000);
    await miband.showNotification('off');
    //
    log('Tap MiBand button, quick!');
    miband.on('button', () => log('Tap detected'));
    try {
        await miband.waitButton(10000)
    } catch (e) {
        log('OK, nevermind ;)')
    }
    await delay(3000);
    log('Heart Rate Monitor (single-shot)');
    log('Result:', await miband.hrmRead());*/
    await delay(5000);
    log('Heart Rate Monitor (continuous )...');
    miband.on('heart_rate', (rate) => {
        log('Heart Rate:', rate)
    });
    await miband.hrmStart();

}

noble.on('discover', function (peripheral) {
    console.log('peripheral discovered (' + peripheral.id +
        ' with address <' + peripheral.address + ', ' + peripheral.addressType + '>,' +
        ' connectable ' + peripheral.connectable + ',' +
        ' RSSI ' + peripheral.rssi + ':' + 'local name: \t' + peripheral.advertisement.localName);
    peripheral.char = {};
    peripheral.service = {};
    if (peripheral.advertisement.localName && peripheral.advertisement.localName.includes('MI Band 2')) {
        noble.stopScanning();
        peripheral.connect(async err => {
            if (!err) {
                try {
                    const services = await util.promisify(peripheral.discoverServices.bind(peripheral))([]);
                    services.forEach(async service => {
                        if (!service) return;

                        peripheral.service[service.uuid] = service;
                        const characteristics = await util.promisify(service.discoverCharacteristics.bind(service))([]);
                        characteristics.forEach(char => {
                            peripheral.char[char.uuid] = char;
                        });
                        // console.log("found service", JSON.stringify(JSON.parse(service), null, 2));
                        // console.log("found characteristic: ", characteristics.toString());
                    });

                    setTimeout(() => init(peripheral), 5000);

                } catch (e) {
                    console.error(e);
                }
            } else {
                console.error(err);
            }
        })
    }
});