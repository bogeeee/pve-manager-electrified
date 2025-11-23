Ext.define('PVE.qemu.USBInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    autoComplete: false,
    onlineHelp: 'qm_usb_passthrough',

    cbindData: function (initialConfig) {
        let me = this;
        if (!me.pveSelNode) {
            throw 'no pveSelNode given';
        }

        return { nodename: me.pveSelNode.data.node };
    },

    viewModel: {
        data: {},
    },

    setVMConfig: function (vmconfig) {
        var me = this;
        me.vmconfig = vmconfig;
        let max_usb = PVE.Utils.get_max_usb_count(me.vmconfig.ostype, me.vmconfig.machine);
        if (max_usb > PVE.Utils.hardware_counts.usb_old) {
            me.down('field[name=usb3]').setDisabled(true);
        }
    },

    onGetValues: function (values) {
        var me = this;
        if (!me.confid) {
            let max_usb = PVE.Utils.get_max_usb_count(me.vmconfig.ostype, me.vmconfig.machine);
            for (let i = 0; i < max_usb; i++) {
                let id = 'usb' + i.toString();
                if (!me.vmconfig[id]) {
                    me.confid = id;
                    break;
                }
            }
        }
        var val = '';
        var type = me.down('radiofield').getGroupValue();
        switch (type) {
            case 'spice':
                val = 'spice';
                break;
            case 'mapped':
                val = `mapping=${values[type]}`;
                delete values.mapped;
                break;
            case 'hostdevice':
            case 'port':
                val = 'host=' + values[type];
                delete values[type];
                break;
            default:
                throw 'invalid type selected';
        }

        if (values.usb3) {
            delete values.usb3;
            val += ',usb3=1';
        }
        values[me.confid] = val;
        return values;
    },

    items: [
        {
            xtype: 'fieldcontainer',
            defaultType: 'radiofield',
            layout: 'fit',
            items: [
                {
                    name: 'usb',
                    inputValue: 'spice',
                    boxLabel: gettext('Spice Port'),
                    submitValue: false,
                    checked: true,
                },
                {
                    name: 'usb',
                    inputValue: 'mapped',
                    boxLabel: gettext('Use mapped Device'),
                    reference: 'mapped',
                    submitValue: false,
                },
                {
                    xtype: 'pveUSBMapSelector',
                    disabled: true,
                    name: 'mapped',
                    cbind: { nodename: '{nodename}' },
                    bind: { disabled: '{!mapped.checked}' },
                    allowBlank: false,
                    fieldLabel: gettext('Choose Device'),
                    labelAlign: 'right',
                },
                {
                    name: 'usb',
                    inputValue: 'hostdevice',
                    boxLabel: gettext('Use USB Vendor/Device ID'),
                    reference: 'hostdevice',
                    submitValue: false,
                },
                {
                    xtype: 'pveUSBSelector',
                    disabled: true,
                    type: 'device',
                    name: 'hostdevice',
                    cbind: { pveSelNode: '{pveSelNode}' },
                    bind: { disabled: '{!hostdevice.checked}' },
                    editable: true,
                    allowBlank: false,
                    fieldLabel: gettext('Choose Device'),
                    labelAlign: 'right',
                },
                {
                    name: 'usb',
                    inputValue: 'port',
                    boxLabel: gettext('Use USB Port'),
                    reference: 'port',
                    submitValue: false,
                },
                {
                    xtype: 'pveUSBSelector',
                    disabled: true,
                    name: 'port',
                    cbind: { pveSelNode: '{pveSelNode}' },
                    bind: { disabled: '{!port.checked}' },
                    editable: true,
                    type: 'port',
                    allowBlank: false,
                    fieldLabel: gettext('Choose Port'),
                    labelAlign: 'right',
                },
                {
                    xtype: 'checkbox',
                    name: 'usb3',
                    inputValue: true,
                    checked: true,
                    reference: 'usb3',
                    fieldLabel: gettext('Use USB3'),
                },
            ],
        },
    ],
});

Ext.define('PVE.qemu.USBEdit', {
    extend: 'Proxmox.window.Edit',

    vmconfig: undefined,

    isAdd: true,
    width: 400,
    subject: gettext('USB Device'),

    initComponent: function () {
        var me = this;

        me.isCreate = !me.confid;

        var ipanel = Ext.create('PVE.qemu.USBInputPanel', {
            confid: me.confid,
            pveSelNode: me.pveSelNode,
        });

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                ipanel.setVMConfig(response.result.data);
                if (me.isCreate) {
                    return;
                }

                let data = PVE.Parser.parsePropertyString(response.result.data[me.confid], 'host');
                let port,
                    hostdevice,
                    mapped,
                    usb3 = false;
                let usb;

                if (data.host) {
                    if (/^(0x)?[a-zA-Z0-9]{4}:(0x)?[a-zA-Z0-9]{4}$/.test(data.host)) {
                        hostdevice = data.host.replace('0x', '');
                        usb = 'hostdevice';
                    } else if (/^(\d+)-(\d+(\.\d+)*)$/.test(data.host)) {
                        port = data.host;
                        usb = 'port';
                    } else if (/^spice$/i.test(data.host)) {
                        usb = 'spice';
                    }
                } else if (data.mapping) {
                    mapped = data.mapping;
                    usb = 'mapped';
                }

                usb3 = data.usb3 ?? false;

                var values = {
                    usb,
                    hostdevice,
                    port,
                    usb3,
                    mapped,
                };

                ipanel.setValues(values);
            },
        });
    },
});
