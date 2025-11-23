Ext.define('PVE.form.QemuBiosSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveQemuBiosSelector'],

    initComponent: function () {
        var me = this;

        me.comboItems = [
            ['__default__', PVE.Utils.render_qemu_bios('')],
            ['seabios', PVE.Utils.render_qemu_bios('seabios')],
            ['ovmf', PVE.Utils.render_qemu_bios('ovmf')],
        ];

        me.callParent();
    },
});
