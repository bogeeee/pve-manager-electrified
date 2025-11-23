Ext.define('PVE.qemu.Smbios1InputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.PVE.qemu.Smbios1InputPanel',

    insideWizard: false,

    smbios1: {},

    onGetValues: function (values) {
        var _me = this;

        var params = {
            smbios1: PVE.Parser.printQemuSmbios1(values),
        };

        return params;
    },

    setSmbios1: function (data) {
        var me = this;

        me.smbios1 = data;

        me.setValues(me.smbios1);
    },

    items: [
        {
            xtype: 'textfield',
            fieldLabel: 'UUID',
            regex: /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/,
            name: 'uuid',
        },
        {
            xtype: 'textareafield',
            fieldLabel: gettext('Manufacturer'),
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'manufacturer',
        },
        {
            xtype: 'textareafield',
            fieldLabel: gettext('Product'),
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'product',
        },
        {
            xtype: 'textareafield',
            fieldLabel: gettext('Version'),
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'version',
        },
        {
            xtype: 'textareafield',
            fieldLabel: gettext('Serial'),
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'serial',
        },
        {
            xtype: 'textareafield',
            fieldLabel: 'SKU',
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'sku',
        },
        {
            xtype: 'textareafield',
            fieldLabel: gettext('Family'),
            fieldStyle: {
                height: '2em',
                minHeight: '2em',
            },
            name: 'family',
        },
    ],
});

Ext.define('PVE.qemu.Smbios1Edit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        var ipanel = Ext.create('PVE.qemu.Smbios1InputPanel', {});

        Ext.applyIf(me, {
            subject: gettext('SMBIOS settings (type1)'),
            width: 450,
            items: ipanel,
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                me.vmconfig = response.result.data;
                var value = me.vmconfig.smbios1;
                if (value) {
                    let data = PVE.Parser.parseQemuSmbios1(value);
                    if (!data) {
                        Ext.Msg.alert(gettext('Error'), 'Unable to parse smbios options');
                        me.close();
                        return;
                    }
                    ipanel.setSmbios1(data);
                }
            },
        });
    },
});
