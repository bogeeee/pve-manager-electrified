Ext.define('PVE.sdn.zones.EvpnInputPanel', {
    extend: 'PVE.panel.SDNZoneBase',

    onlineHelp: 'pvesdn_zone_plugin_evpn',

    onGetValues: function (values) {
        var me = this;

        if (me.isCreate) {
            values.type = me.type;
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'pveSDNControllerSelector',
                fieldLabel: gettext('Controller'),
                name: 'controller',
                value: '',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'vrf-vxlan',
                minValue: 1,
                maxValue: 16000000,
                fieldLabel: 'VRF-VXLAN Tag',
                allowBlank: false,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'mac',
                fieldLabel: gettext('VNet MAC Address'),
                vtype: 'MacAddress',
                allowBlank: true,
                emptyText: 'auto',
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'pveNodeSelector',
                name: 'exitnodes',
                fieldLabel: gettext('Exit Nodes'),
                multiSelect: true,
                autoSelect: false,
            },
            {
                xtype: 'pveNodeSelector',
                name: 'exitnodes-primary',
                fieldLabel: gettext('Primary Exit Node'),
                multiSelect: false,
                autoSelect: false,
                skipEmptyText: true,
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'exitnodes-local-routing',
                uncheckedValue: null,
                checked: false,
                fieldLabel: gettext('Exit Nodes Local Routing'),
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'advertise-subnets',
                uncheckedValue: null,
                checked: false,
                fieldLabel: gettext('Advertise Subnets'),
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'disable-arp-nd-suppression',
                uncheckedValue: null,
                checked: false,
                fieldLabel: gettext('Disable ARP-nd Suppression'),
                deleteEmpty: !me.isCreate,
            },
            {
                xtype: 'proxmoxtextfield',
                name: 'rt-import',
                fieldLabel: gettext('Route Target Import'),
                allowBlank: true,
                deleteEmpty: !me.isCreate,
            },
        ];

        me.callParent();
    },
});
