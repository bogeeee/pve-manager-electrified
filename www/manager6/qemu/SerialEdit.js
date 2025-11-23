Ext.define('PVE.qemu.SerialnputPanel', {
    extend: 'Proxmox.panel.InputPanel',

    autoComplete: false,

    setVMConfig: function (vmconfig) {
        var me = this,
            i;
        me.vmconfig = vmconfig;

        for (i = 0; i < 4; i++) {
            let port = 'serial' + i.toString();
            if (!me.vmconfig[port]) {
                me.down('field[name=serialid]').setValue(i);
                break;
            }
        }
    },

    onGetValues: function (values) {
        var _me = this;

        var id = 'serial' + values.serialid;
        delete values.serialid;
        values[id] = 'socket';
        return values;
    },

    items: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'serialid',
            fieldLabel: gettext('Serial Port'),
            minValue: 0,
            maxValue: 3,
            allowBlank: false,
            validator: function (id) {
                if (!this.rendered) {
                    return true;
                }
                let view = this.up('panel');
                if (view.vmconfig !== undefined && Ext.isDefined(view.vmconfig['serial' + id])) {
                    return 'This device is already in use.';
                }
                return true;
            },
        },
    ],
});

Ext.define('PVE.qemu.SerialEdit', {
    extend: 'Proxmox.window.Edit',

    vmconfig: undefined,

    isAdd: true,

    subject: gettext('Serial Port'),

    initComponent: function () {
        var me = this;

        // for now create of (socket) serial port only
        me.isCreate = true;

        var ipanel = Ext.create('PVE.qemu.SerialnputPanel', {});

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                ipanel.setVMConfig(response.result.data);
            },
        });
    },
});
