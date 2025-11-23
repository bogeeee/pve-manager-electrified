Ext.define('PVE.qemu.IPConfigPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveIPConfigPanel',

    insideWizard: false,

    vmconfig: {},

    onGetValues: function (values) {
        var me = this;

        if (values.ipv4mode !== 'static') {
            values.ip = values.ipv4mode;
        }

        if (values.ipv6mode !== 'static') {
            values.ip6 = values.ipv6mode;
        }

        var params = {};

        var cfg = PVE.Parser.printIPConfig(values);
        if (cfg === '') {
            params.delete = [me.confid];
        } else {
            params[me.confid] = cfg;
        }
        return params;
    },

    setVMConfig: function (config) {
        var me = this;
        me.vmconfig = config;
    },

    setIPConfig: function (confid, data) {
        var me = this;

        me.confid = confid;

        if (data.ip === 'dhcp') {
            data.ipv4mode = data.ip;
            data.ip = '';
        } else {
            data.ipv4mode = 'static';
        }
        if (data.ip6 === 'dhcp' || data.ip6 === 'auto') {
            data.ipv6mode = data.ip6;
            data.ip6 = '';
        } else {
            data.ipv6mode = 'static';
        }

        me.ipconfig = data;
        me.setValues(me.ipconfig);
    },

    initComponent: function () {
        var me = this;

        me.ipconfig = {};

        me.column1 = [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Network Device'),
                value: me.netid,
            },
            {
                layout: {
                    type: 'hbox',
                    align: 'middle',
                },
                border: false,
                margin: '0 0 5 0',
                items: [
                    {
                        xtype: 'label',
                        text: gettext('IPv4') + ':',
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('Static'),
                        name: 'ipv4mode',
                        inputValue: 'static',
                        checked: false,
                        margin: '0 0 0 10',
                        listeners: {
                            change: function (cb, value) {
                                me.down('field[name=ip]').setDisabled(!value);
                                me.down('field[name=gw]').setDisabled(!value);
                            },
                        },
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('DHCP'),
                        name: 'ipv4mode',
                        inputValue: 'dhcp',
                        checked: false,
                        margin: '0 0 0 10',
                    },
                ],
            },
            {
                xtype: 'textfield',
                name: 'ip',
                vtype: 'IPCIDRAddress',
                value: '',
                disabled: true,
                fieldLabel: gettext('IPv4/CIDR'),
            },
            {
                xtype: 'textfield',
                name: 'gw',
                value: '',
                vtype: 'IPAddress',
                disabled: true,
                fieldLabel: gettext('Gateway') + ' (' + gettext('IPv4') + ')',
            },
        ];

        me.column2 = [
            {
                xtype: 'displayfield',
            },
            {
                layout: {
                    type: 'hbox',
                    align: 'middle',
                },
                border: false,
                margin: '0 0 5 0',
                items: [
                    {
                        xtype: 'label',
                        text: gettext('IPv6') + ':',
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('Static'),
                        name: 'ipv6mode',
                        inputValue: 'static',
                        checked: false,
                        margin: '0 0 0 10',
                        listeners: {
                            change: function (cb, value) {
                                me.down('field[name=ip6]').setDisabled(!value);
                                me.down('field[name=gw6]').setDisabled(!value);
                            },
                        },
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('DHCP'),
                        name: 'ipv6mode',
                        inputValue: 'dhcp',
                        checked: false,
                        margin: '0 0 0 10',
                    },
                    {
                        xtype: 'radiofield',
                        boxLabel: gettext('SLAAC'),
                        name: 'ipv6mode',
                        inputValue: 'auto',
                        checked: false,
                        margin: '0 0 0 10',
                    },
                ],
            },
            {
                xtype: 'textfield',
                name: 'ip6',
                value: '',
                vtype: 'IP6CIDRAddress',
                disabled: true,
                fieldLabel: gettext('IPv6/CIDR'),
            },
            {
                xtype: 'textfield',
                name: 'gw6',
                vtype: 'IP6Address',
                value: '',
                disabled: true,
                fieldLabel: gettext('Gateway') + ' (' + gettext('IPv6') + ')',
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.IPConfigEdit', {
    extend: 'Proxmox.window.Edit',

    isAdd: true,

    initComponent: function () {
        var me = this;

        // convert confid from netX to ipconfigX
        var match = me.confid.match(/^net(\d+)$/);
        if (match) {
            me.netid = me.confid;
            me.confid = 'ipconfig' + match[1];
        }

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.isCreate = !me.confid;

        var ipanel = Ext.create('PVE.qemu.IPConfigPanel', {
            confid: me.confid,
            netid: me.netid,
            nodename: nodename,
        });

        Ext.applyIf(me, {
            subject: gettext('Network Config'),
            items: ipanel,
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                me.vmconfig = response.result.data;
                var ipconfig = {};
                var value = me.vmconfig[me.confid];
                if (value) {
                    ipconfig = PVE.Parser.parseIPConfig(me.confid, value);
                    if (!ipconfig) {
                        Ext.Msg.alert(
                            gettext('Error'),
                            gettext('Unable to parse network configuration'),
                        );
                        me.close();
                        return;
                    }
                }
                ipanel.setIPConfig(me.confid, ipconfig);
                ipanel.setVMConfig(me.vmconfig);
            },
        });
    },
});
