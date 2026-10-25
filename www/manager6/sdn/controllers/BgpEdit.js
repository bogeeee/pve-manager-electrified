Ext.define('PVE.sdn.controllers.BgpInputPanel', {
    extend: 'PVE.panel.SDNControllerBase',

    onlineHelp: 'pvesdn_controller_plugin_BGP',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
            values.controller = 'bgp' + values.node;
        } else {
            delete values.controller;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'pveNodeSelector',
                name: 'node',
                fieldLabel: gettext('Node'),
                multiSelect: false,
                autoSelect: false,
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
                xtype: 'textfield',
                name: 'peers',
                fieldLabel: gettext('Peers'),
                allowBlank: false,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'ebgp',
                uncheckedValue: 0,
                checked: false,
                fieldLabel: 'EBGP',
            },
        ];

        me.advancedItems = [
            {
                xtype: 'textfield',
                name: 'loopback',
                fieldLabel: gettext('Loopback Interface'),
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'ebgp-multihop',
                minValue: 1,
                maxValue: 100,
                fieldLabel: 'ebgp-multihop',
                allowBlank: true,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'bgp-multipath-as-path-relax',
                uncheckedValue: 0,
                checked: false,
                fieldLabel: 'bgp-multipath-as-path-relax',
            },
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
        ];

        me.callParent();
    },
});
