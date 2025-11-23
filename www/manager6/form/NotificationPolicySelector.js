Ext.define('PVE.form.EmailNotificationSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveEmailNotificationSelector'],
    comboItems: [
        ['always', gettext('Always')],
        ['failure', gettext('On failure only')],
    ],
});
