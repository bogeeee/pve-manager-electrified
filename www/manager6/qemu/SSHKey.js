Ext.define('PVE.qemu.SSHKeyInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveQemuSSHKeyInputPanel',

    insideWizard: false,

    onGetValues: function (values) {
        var _me = this;
        if (values.sshkeys) {
            values.sshkeys.trim();
        }
        if (!values.sshkeys.length) {
            values = {};
            values.delete = 'sshkeys';
            return values;
        } else {
            values.sshkeys = encodeURIComponent(values.sshkeys);
        }
        return values;
    },

    items: [
        {
            xtype: 'textarea',
            itemId: 'sshkeys',
            name: 'sshkeys',
            height: 250,
        },
        {
            xtype: 'filebutton',
            itemId: 'filebutton',
            name: 'file',
            text: gettext('Load SSH Key File'),
            fieldLabel: 'test',
            listeners: {
                change: function (btn, e, value) {
                    let view = this.up('inputpanel');
                    e = e.event;
                    Ext.Array.each(e.target.files, function (file) {
                        PVE.Utils.loadSSHKeyFromFile(file, function (res) {
                            let keysField = view.down('#sshkeys');
                            var old = keysField.getValue();
                            keysField.setValue(old + res);
                        });
                    });
                    btn.reset();
                },
            },
        },
    ],

    initComponent: function () {
        var me = this;

        me.callParent();
        if (!window.FileReader) {
            me.down('#filebutton').setVisible(false);
        }
    },
});

Ext.define('PVE.qemu.SSHKeyEdit', {
    extend: 'Proxmox.window.Edit',

    width: 800,

    initComponent: function () {
        var me = this;

        var ipanel = Ext.create('PVE.qemu.SSHKeyInputPanel');

        Ext.apply(me, {
            subject: gettext('SSH Keys'),
            items: [ipanel],
        });

        me.callParent();

        if (!me.create) {
            me.load({
                success: function (response, options) {
                    var data = response.result.data;
                    if (data.sshkeys) {
                        data.sshkeys = decodeURIComponent(data.sshkeys);
                        ipanel.setValues(data);
                    }
                },
            });
        }
    },
});
