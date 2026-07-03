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

        me.advancedItems = [
            {
                xtype: 'pveSDNRouteMapSelector',
                name: 'route-map-in',
                // TRANSLATORS: "Route map" refers to an FRR route map, some
                // languages may prefer to keep it as-is:
                // https://docs.frrouting.org/en/latest/routemap.html
                fieldLabel: gettext('Incoming Route Map'),
                deleteEmpty: !me.isCreate,
                skipEmptyText: true,
            },
            {
                xtype: 'pveSDNRouteMapSelector',
                name: 'route-map-out',
                // TRANSLATORS: "Route map" refers to an FRR route map, some
                // languages may prefer to keep it as-is:
                // https://docs.frrouting.org/en/latest/routemap.html
                fieldLabel: gettext('Outgoing Route Map'),
                deleteEmpty: !me.isCreate,
                skipEmptyText: true,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'peer-group-name',
                fieldLabel: gettext('Peer Group Name'),
                allowBlank: true,
                deleteEmpty: !me.isCreate,
                skipEmptyText: true,
            },
            {
                xtype: 'pveNodeSelector',
                name: 'nodes',
                fieldLabel: gettext('Nodes'),
                multiSelect: true,
                autoSelect: false,
                allowBlank: true,
                deleteEmpty: !me.isCreate,
                skipEmptyText: true,
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'bgp-mode',
                value: '',
                emptyText: 'Automatic',
                comboItems: [
                    ['auto', gettext('Automatic')],
                    ['external', gettext('eBGP')],
                    ['internal', gettext('iBGP')],
                ],
                fieldLabel: gettext('BGP Mode'),
                allowBlank: true,
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'ebgp-multihop',
                minValue: 1,
                maxValue: 100,
                fieldLabel: gettext('eBGP Multihop'),
                allowBlank: true,
                deleteEmpty: !me.isCreate,
            },
        ];

        me.callParent();
    },
});
