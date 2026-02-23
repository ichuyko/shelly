/**
 * @title Script for a smart plug powering a router
 * @description A script for a router that periodically checks whether the router is powered on and has internet connectivity, and automatically power-cycles the router if the internet is unavailable.
 * @status production
 * @link https://github.com/ichuyko/shelly
 * @version 2.0.0
 */

const START_DELAY_SEC = 60; // 1 min
const CHECK_INTERVAL_SEC = 60 * 60 * 2; // 2 hours
const POWER_TOGGLE_AFTER_SEC = 30; // 30 sec
const SWITCH_ID = 0;

let info = {
  startAt: new Date(),
  checkTimer: null,
  delayStartTimer: null,
  checkNetCounter: 0,
  checkPowerCounter: 0,
  powerFailCounter: 0,
};

print("Started myCheckerApp. With first check delay, sec", START_DELAY_SEC);

function powerOFFandON() {
  info.lastPowerOFFandONAt = new Date();
  print("powerOFFandON: Let's power OFF and toggle_after in sec", POWER_TOGGLE_AFTER_SEC);
  Shelly.call("Switch.Set",
    { id: SWITCH_ID, on: false, toggle_after: POWER_TOGGLE_AFTER_SEC },
    function () {}
  );
}

function powerON() {
  info.lastPowerONAt = new Date();
  print("powerON: Let's power ON");
  Shelly.call("Switch.Set", { id: SWITCH_ID, on: true });
}

function checkNet() {
  info.lastCheckNetAt = new Date();
  info.checkNetCounter++;

  const checkURL = "http://captive.apple.com/hotspot-detect.html";
  print("checkNet #", info.checkNetCounter, ", URL ", checkURL);

    Shelly.call(
    "http.get",
    { url: checkURL, timeout: 10 },
    function (response, error_code, error_message) {
      info.lastCheckNetResult = new Date().toString() + ", " + error_code + ", " + error_message;

       print("checkNet: On HTTP response. error_code, error_message ", error_code, error_message);
      //http timeout, magic number, not yet documented
      if (error_code === -114 || error_code === -104) {
        print("checkNet: Failed to fetch. No internet connection!");
        powerOFFandON();
      } else {
        print("checkNet: Internet connection is OK");
      }

    }
  );

}

function checkPower(src) {
  info.lastCheckPowerAt = new Date();
  info.nextCheckPowerAt = new Date(info.lastCheckPowerAt.getTime() + CHECK_INTERVAL_SEC * 1000);
  info.checkPowerCounter++;

  print("checkPower: #", info.checkPowerCounter, "src is", src || "timer");
  Shelly.call(
    "Switch.GetStatus",
    { id: SWITCH_ID },
    function (res, err) {

      if (err) {
        info.powerFailCounter++;
        info.lastCheckPowerResult = new Date().toString() + " ERROR: " + err;
        print("checkPowerOn: ERROR getting switch status:", err, ", powerFailCounter" , info.powerFailCounter);

        if (info.powerFailCounter > 10) {
          print("checkPowerOn: failCounter is 10. Let's call powerOFFandON()!");
          info.powerFailCounter = 0;
          powerOFFandON();
        }
        return;
      }

      if (res.output === false) {
        info.lastCheckPowerResult = new Date().toString() + " Power is OFF, turning ON";
        print("checkPowerOn: Power is OFF, turning ON");
        powerOFFandON();
      } else {
        info.lastCheckPowerResult = new Date().toString() + " Power is ON";
        print("checkPowerOn: Power is ON");
        checkNet();
      }
    }
  );

}

function delayStart() {
  print("delayStart: Let's start checkTimer after delay");
  info.skipCheckEnabledTill = null;
  Timer.clear(info.delayStartTimer);

  checkPower("Start checkPower immediately after start main timer", CHECK_INTERVAL_SEC)
  info.checkTimer = Timer.set(CHECK_INTERVAL_SEC * 1000, true, checkPower);
}


Timer.clear(info.checkTimer);
Timer.clear(info.delayStartTimer);
info.delayStartTimer = Timer.set(START_DELAY_SEC * 1000, false, delayStart);


// in case 0/undefied hour - just restart timer now with immediately run check!
function skipChecksNextHours(hours) {
  Timer.clear(info.checkTimer);
  Timer.clear(info.delayStartTimer);

  const skipDelaySec = (hours || 0) * 60 * 60;
  info.skipCheckEnabledTill = new Date(new Date().getTime() + skipDelaySec * 1000);
  print("skipChecksNextHours: Let's skip checkTimer for", skipDelaySec, "sec");

  info.delayStartTimer = Timer.set(skipDelaySec * 1000, false, delayStart);
}

// Get all info
// print(info)

// Next check at:
// print("Next check at", new Date(info.lastCheckPowerAt.getTime() + CHECK_INTERVAL_SEC * 1000))

// Next check in sec:
// print("Next check in ", Math.round(new Date(info.lastCheckPowerAt.getTime() + CHECK_INTERVAL_SEC * 1000) - new Date()) / 1000, " sec")

// Skip check for 48 hours
// skipChecksNextHours(48)

// Skip check for 12 mins
// skipChecksNextHours(0.2)

// Skip check for 1.2 mins
// skipChecksNextHours(0.02)
