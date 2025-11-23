Ext.define('PVE.form.NotificationModeSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveNotificationModeSelector'],
    comboItems: [
        ['notification-target', gettext('Target')],
        ['mailto', gettext('E-Mail')],
    ],
});
