Ext.define('PVE.sdn.controllers.EvpnInputPanel', {
    extend: 'PVE.panel.SDNControllerBase',

    onlineHelp: 'pvesdn_controller_plugin_evpn',

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'controller',
                maxLength: 8,
                value: me.controllerid || '',
                fieldLabel: 'ID',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'asn',
                minValue: 1,
                maxValue: 4294967295,
                value: 65000,
                fieldLabel: 'ASN #',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxNetworkSelector',
                name: 'fabric',
                type: 'fabric',
                valueField: 'iface',
                displayField: 'iface',
                fieldLabel: 'SDN Fabric',
                allowBlank: true,
                deleteEmpty: true,
                skipEmptyText: true,
                autoSelect: false,
                emptyText: gettext('used as underlay network'),
                nodename: 'localhost',
                listConfig: {
                    width: 600,
                    columns: [
                        {
                            header: gettext('Fabric'),
                            width: 90,
                            dataIndex: 'iface',
                        },
                        {
                            header: gettext('CIDR'),
                            dataIndex: 'cidr',
                            hideable: false,
                            flex: 1,
                        },
                    ],
                },
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'peers',
                fieldLabel: gettext('Peers'),
                allowBlank: true,
                deleteEmpty: true,
            },
        ];

        me.callParent();
    },
});
