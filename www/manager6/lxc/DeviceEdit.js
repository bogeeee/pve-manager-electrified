Ext.define('PVE.lxc.DeviceInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    autoComplete: false,

    controller: {
        xclass: 'Ext.app.ViewController',
    },

    setVMConfig: function (vmconfig) {
        let me = this;
        me.vmconfig = vmconfig;

        if (me.isCreate) {
            PVE.Utils.forEachLxcDev((i, name) => {
                if (!Ext.isDefined(vmconfig[name])) {
                    me.confid = name;
                    me.down('field[name=devid]').setValue(i);
                    return false;
                }
                return undefined;
            });
        }
    },

    onGetValues: function (values) {
        let me = this;
        let confid = me.isCreate ? 'dev' + values.devid : me.confid;
        delete values.devid;
        let val = PVE.Parser.printPropertyString(values, 'path');
        let ret = {};
        ret[confid] = val;
        return ret;
    },

    items: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'devid',
            minValue: 0,
            maxValue: PVE.Utils.lxc_dev_count - 1,
            hidden: true,
            allowBlank: false,
            disabled: true,
            cbind: {
                disabled: '{!isCreate}',
            },
        },
        {
            xtype: 'textfield',
            name: 'path',
            fieldLabel: gettext('Device Path'),
            labelWidth: 120,
            editable: true,
            allowBlank: false,
            emptyText: '/dev/xyz',
            validator: (v) =>
                v.startsWith('/dev/') ? true : gettext('Path has to start with /dev/'),
        },
    ],

    advancedColumn1: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'uid',
            editable: true,
            fieldLabel: Ext.String.format(gettext('{0} in CT'), 'UID'),
            labelWidth: 120,
            emptyText: '0',
            minValue: 0,
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'gid',
            editable: true,
            fieldLabel: Ext.String.format(gettext('{0} in CT'), 'GID'),
            labelWidth: 120,
            emptyText: '0',
            minValue: 0,
        },
    ],

    advancedColumn2: [
        {
            xtype: 'textfield',
            name: 'mode',
            editable: true,
            fieldLabel: Ext.String.format(gettext('Access Mode in CT')),
            labelWidth: 120,
            emptyText: '0660',
            validator: function (value) {
                if (/^0[0-7]{3}$|^$/i.test(value)) {
                    return true;
                }
                return gettext('Access mode has to be an octal number');
            },
        },
        {
            xtype: 'checkbox',
            name: 'deny-write',
            fieldLabel: gettext('Read only'),
            labelWidth: 120,
            checked: false,
        },
    ],
});

Ext.define('PVE.lxc.DeviceEdit', {
    extend: 'Proxmox.window.Edit',

    vmconfig: undefined,

    isAdd: true,
    width: 450,

    initComponent: function () {
        let me = this;

        me.isCreate = !me.confid;

        let ipanel = Ext.create('PVE.lxc.DeviceInputPanel', {
            confid: me.confid,
            isCreate: me.isCreate,
            pveSelNode: me.pveSelNode,
        });

        let subject;
        if (me.isCreate) {
            subject = gettext('Device');
        } else {
            subject = gettext('Device') + ' (' + me.confid + ')';
        }

        Ext.apply(me, {
            subject: subject,
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                ipanel.setVMConfig(response.result.data);
                if (me.isCreate) {
                    return;
                }

                let data = PVE.Parser.parsePropertyString(response.result.data[me.confid], 'path');

                let values = {
                    path: data.path,
                    mode: data.mode,
                    uid: data.uid,
                    gid: data.gid,
                    'deny-write': data['deny-write'],
                };

                ipanel.setValues(values);
            },
        });
    },
});
