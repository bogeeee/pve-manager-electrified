Ext.define('PVE.form.BusTypeSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: 'widget.pveBusSelector',

    withVirtIO: true,
    withUnused: false,

    initComponent: function () {
        var me = this;

        me.comboItems = [
            ['ide', 'IDE'],
            ['sata', 'SATA'],
        ];

        if (me.withVirtIO) {
            me.comboItems.push(['virtio', 'VirtIO Block']);
        }

        me.comboItems.push(['scsi', 'SCSI']);

        if (me.withUnused) {
            me.comboItems.push(['unused', 'Unused']);
        }

        me.callParent();
    },
});
