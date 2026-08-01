#pragma once

#include <Arduino.h>

// Starts the device provisioning state manager.
// The provisioning token is never written to NVS; only the paired result is persisted.
void setupProvisioning();

// Runs the pending claim immediately. appSetup calls this before MQTT/BLE are
// started so the TLS handshake has enough free heap.
bool attemptProvisioningNow();

// Retries a pending claim while Wi-Fi is connected.
void updateProvisioning();

// Queues a one-time provisioning claim.
// Intended for the future mobile/BLE setup flow. The token remains only in RAM.
bool requestProvisioningClaim(
    const String& token,
    const String& claimUrl = ""
);

bool isDeviceProvisioned();
bool isProvisioningClaimPending();

String provisioningStatusName();
String provisioningLastMessage();
int provisioningLastHttpCode();
