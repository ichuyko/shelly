/****************************************************
 * Shelly Router Watchdog
 *
 * router-watchdog-shelly.js
 *
 * version 2.0.1
 *
 ****************************************************/

/****************************************************
 * Configuration
 ****************************************************/

const SWITCH_ID = 0;
const BOOT_WAIT_SEC = 60 * 5;
const CHECK_INTERVAL_SEC = 60 * 60 * 2;
const INTERNET_RETRY_DELAY_SEC = 60 * 5;
const INTERNET_RETRY_COUNT = 3;
const POWER_TOGGLE_AFTER_SEC = 60;

/****************************************************
 * Status
 ****************************************************/

const STATUS = {
    STARTING: "STARTING",
    IDLE: "IDLE",
    CHECK_POWER: "CHECK_POWER",
    WAIT_BOOT: "WAIT_BOOT",
    CHECK_INTERNET: "CHECK_INTERNET",
    WAIT_INTERNET_RETRY: "WAIT_INTERNET_RETRY",
};

const INTERNET_URLS = [
    "http://captive.apple.com/hotspot-detect.html",
    "https://connectivitycheck.gstatic.com/generate_204",
    "http://1.1.1.1"
];

/****************************************************
 * Reasons
 ****************************************************/

const REASON = {
    STARTUP: "STARTUP",
    RELAY_ALREADY_ON: "RELAY_ALREADY_ON",
    RELAY_WAS_OFF: "RELAY_WAS_OFF",
    POWER_RESTORED: "POWER_RESTORED",
    GETSTATUS_ERROR: "GETSTATUS_ERROR",
    POWERON_ERROR: "POWERON_ERROR",
    CHECK_INTERVAL: "CHECK_INTERVAL",
    REBOOT_ROUTER: "REBOOT_ROUTER",
};

/****************************************************
 * Runtime state
 ****************************************************/

let state = {
    status: STATUS.STARTING,
    timer: null,
    currentUrl: "",
    retryCounter: 0,
    checkInProgress: false
};
/****************************************************
 * Diagnostic information
 ****************************************************/

let info = {
    startAt: Date.now(),
    lastReason: REASON.STARTUP,
    lastPowerOnAt: 0,
    powerOnCounter: 0,
    lastCheckedUrl: "",
    lastSuccessfulUrl: "",
    lastFailedUrl: "",
    lastHttpCode: 0,
    lastHttpError: 0,
    lastPowerCycleAt: 0,
    powerCycleCounter: 0,
};


function onPowerCycle(res, err) {

    if (err) {
        print("Power cycle ERROR:", err);
    } else {
        print("Power cycle started");
    }

    state.status = STATUS.WAIT_BOOT;

    scheduleMainChecker(
        BOOT_WAIT_SEC + POWER_TOGGLE_AFTER_SEC,
        REASON.POWER_RESTORED
    );
}


/****************************************************
 * Power cycle callback
 ****************************************************/

function onPowerCycleStatus(res, err) {
    if (err) {
        print("Switch.GetStatus ERROR:", err);
        //
        // Не удалось узнать состояние.
        // Для надежности просто пробуем включить питание.
        //
        powerON();
        return;
    }

    //
    // Relay already OFF.
    // Just turn it ON.
    //
    if (!res.output) {
        print("Relay already OFF. Power ON only.");
        powerON();
        return;
    }

    //
    // Relay is ON.
    // Normal power cycle.
    //
    info.lastPowerCycleAt = Date.now();

    info.powerCycleCounter++;

    print("Power cycling router...");

    Shelly.call(
        "Switch.Set",
        {
            id: SWITCH_ID,
            on: false,
            toggle_after: POWER_TOGGLE_AFTER_SEC
        },
        onPowerCycle
    );

}

/****************************************************
 * Power cycle
 ****************************************************/

function powerCycle() {
    Shelly.call(
        "Switch.GetStatus",
        {
            id: SWITCH_ID
        },
        onPowerCycleStatus
    );
}


function clearCurrentInternetUrl() {
    state.currentUrl = "";
}

function setCurrentInternetUrl(url) {
    state.currentUrl = url;
}

function getNextInternetUrl(currentUrl) {
    if (currentUrl === "") {
        return INTERNET_URLS[0];
    }

    var i;
    for (i = 0; i < INTERNET_URLS.length; i++) {
        if (INTERNET_URLS[i] === currentUrl) {
            if (i + 1 < INTERNET_URLS.length) {
                return INTERNET_URLS[i + 1];
            }
            return null;
        }
    }

    return null;
}

function moveToNextInternetUrl() {
    var nextUrl;
    nextUrl = getNextInternetUrl(
        state.currentUrl
    );

    if (nextUrl === null) {
        clearCurrentInternetUrl();
        onInternetFAIL();
        return;
    }

    setCurrentInternetUrl(nextUrl);
    checkCurrentInternetUrl();
}

function checkCurrentInternetUrl() {
    state.status = STATUS.CHECK_INTERNET;
    info.lastCheckedUrl = state.currentUrl;

    print(
        "Checking:",
        state.currentUrl
    );

    Shelly.call(
        "http.get",
        {
            url: state.currentUrl,
            timeout: 10
        },
        onInternetResponse
    );

}

function onInternetResponse(result, errorCode, errorMessage) {
    info.lastHttpError = errorCode;

    if (
        result &&
        result.code !== undefined
    ) {
        info.lastHttpCode = result.code;
    } else {
        info.lastHttpCode = 0;
    }

    //
    // Internet is available.
    //
    if (!errorCode) {

        info.lastSuccessfulUrl = state.currentUrl;
        clearCurrentInternetUrl();
        onInternetOK();
        return;
    }

    //
    // Current URL failed.
    //
    info.lastFailedUrl = state.currentUrl;

    print(
        "FAILED:",
        state.currentUrl,
        errorCode,
        errorMessage
    );

    moveToNextInternetUrl();

}

function onInternetOK() {
    state.retryCounter = 0;
    clearCurrentInternetUrl();
    print("Internet OK");

    state.status = STATUS.WAIT_BOOT;
    scheduleMainChecker(
        CHECK_INTERVAL_SEC,
        REASON.CHECK_INTERVAL
    );
}

function onInternetFAIL() {
    state.retryCounter++;
    clearCurrentInternetUrl();
    print(
        "Internet FAIL. Retry",
        state.retryCounter,
        "of",
        INTERNET_RETRY_COUNT
    );

    //
    // Retry later
    //
    if (state.retryCounter < INTERNET_RETRY_COUNT) {
        state.status = STATUS.WAIT_INTERNET_RETRY;
        scheduleMainChecker(
            INTERNET_RETRY_DELAY_SEC,
            REASON.CHECK_INTERVAL
        );
        return;
    }

    print(
        "Retry limit reached."
    );

    state.retryCounter = 0;
    state.status = STATUS.REBOOT_ROUTER;
    powerCycle();
}

function checkInternet() {
    if (INTERNET_URLS.length === 0) {
        print("INTERNET_URLS is empty");
        state.status = STATUS.WAIT_BOOT;
        scheduleMainChecker(
            CHECK_INTERVAL_SEC,
            REASON.CHECK_INTERVAL
        );
        return;
    }

    state.status = STATUS.CHECK_INTERNET;
    clearCurrentInternetUrl();
    moveToNextInternetUrl();
}


function onStartupStatus(res, err) {
    if (err) {
        print("Switch.GetStatus ERROR:", err);
        state.status = STATUS.WAIT_BOOT;

        scheduleMainChecker(
            BOOT_WAIT_SEC,
            REASON.GETSTATUS_ERROR
        );
        return;
    }

    if (res.output) {
        print("Relay already ON");
        state.status = STATUS.WAIT_BOOT;
        scheduleMainChecker(
            BOOT_WAIT_SEC,
            REASON.RELAY_ALREADY_ON
        );
        return;
    }

    print("Relay is OFF");
    powerON();
}

function onMainCheckPowerStatus(res, err) {
    state.checkInProgress = false;
    state.status = STATUS.CHECK_POWER;

    if (err) {
        print("Switch.GetStatus ERROR:", err);
        scheduleMainChecker(
            BOOT_WAIT_SEC,
            REASON.GETSTATUS_ERROR
        );
        return;
    }

    if (!res.output) {
        print("Relay is OFF");
        powerON();
        return;
    }

    print("Relay is ON");
    checkInternet();
}


/****************************************************
 * Timer callback
 ****************************************************/

function onTimer() {
    state.timer = null;
    if (state.status === STATUS.WAIT_BOOT) {
        mainChecker();
        return;
    }

    if (state.status === STATUS.WAIT_INTERNET_RETRY) {
        checkInternet();
        return;
    }

    print(
        "Unexpected timer state:",
        state.status
    );
}

/****************************************************
 * Schedule main checker
 ****************************************************/

function scheduleMainChecker(delaySec, reason) {
    if (state.timer !== null) {
        Timer.clear(state.timer);
        state.timer = null;
    }

    info.lastReason = reason;

    print(
        "Next mainChecker() in",
        delaySec,
        "sec. Reason:",
        reason
    );

    state.timer = Timer.set(
        delaySec * 1000,
        false,
        onTimer
    );
}

function powerON() {
    print("Turning relay ON");
    Shelly.call(
        "Switch.Set",
        {
            id: SWITCH_ID,
            on: true
        },
        onPowerOn
    );
}

/****************************************************
 * Main checker
 ****************************************************/

function mainChecker() {
    print("--------------------------------");
    print("mainChecker()");

    if (state.checkInProgress) {
        print("mainChecker already running");
        return;
    }

    state.checkInProgress = true;

    Shelly.call(
        "Switch.GetStatus",
        {
            id: SWITCH_ID
        },
        onMainCheckPowerStatus
    );

}

/****************************************************
 * Startup
 ****************************************************/

function startup() {
    print("Shelly Router Watchdog started");

    state.status = STATUS.STARTING;
    info.lastReason = REASON.STARTUP;

    Shelly.call(
        "Switch.GetStatus",
        {
            id: SWITCH_ID
        },
        onStartupStatus
    );
}

/****************************************************
 * Entry point
 ****************************************************/

startup();


function onPowerOn(res, err) {

    if (err) {
        print("powerON ERROR:", err);
        state.status = STATUS.WAIT_BOOT;

        scheduleMainChecker(
            BOOT_WAIT_SEC,
            REASON.POWERON_ERROR
        );
        return;
    }

    info.lastPowerOnAt = Date.now();
    info.powerOnCounter++;
    state.status = STATUS.WAIT_BOOT;

    print("Relay turned ON");

    scheduleMainChecker(
        BOOT_WAIT_SEC,
        REASON.POWER_RESTORED
    );
}