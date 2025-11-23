Ext.define('PVE.qemu.KeyboardEdit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        Ext.applyIf(me, {
            subject: gettext('Keyboard Layout'),
            items: {
                xtype: 'VNCKeyboardSelector',
                name: 'keyboard',
                value: '__default__',
                fieldLabel: gettext('Keyboard Layout'),
            },
        });

        me.callParent();

        me.load();
    },
});
