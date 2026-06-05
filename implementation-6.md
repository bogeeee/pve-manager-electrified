# Implementation for #6

See issue #6 for details.

Attempting to run `bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/tools/pve/update-apps.sh)"`


It starts out ok finding my LXC containers, asks which to update, if I want to backup, then when it starts the backup process the pvenodejsserver.service crashes and I have to restart it to get back into the GUI. this is the info from the crash.


```
Jun 05 08:53:07 minas-tirith npm[128924]: /usr/share/pve-manager-nodejsserver/node_modules/restfuncs-server/Se