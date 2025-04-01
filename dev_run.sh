#!/bin/bash

# rebuilds the pve-manager-electrified and starts the server (with frontend debugging)

systemctl stop pveproxy.service
make install
systemctl daemon-reload
systemctl restart pveproxy.service