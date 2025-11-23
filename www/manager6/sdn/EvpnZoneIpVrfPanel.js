Ext.define('IpVrfRoute', {
    extend: 'Ext.data.Model',
    fields: ['ip', 'metric', 'nexthops', 'protocol'],
});

Ext.define('PVE.sdn.EvpnZoneIpVrfPanel', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNEvpnZoneIpVrfPanel',

    title: gettext('IP-VRF'),
    onlineHelp: 'pvesdn_zone_plugin_evpn',

    stateful: true,
    stateId: 'grid-sdn-ip-vrf',

    columns: [
        {
            text: gettext('CIDR'),
            flex: 2,
            sortable: true,
            dataIndex: 'ip',
        },
        {
            text: gettext('Nexthop'),
            flex: 3,
            dataIndex: 'nexthops',
            renderer: (value) => {
                if (Ext.isArray(value)) {
                    return value.join('<br>');
                }
                return value || '';
            },
        },
        {
            text: gettext('Protocol'),
            flex: 1,
            sortable: true,
            dataIndex: 'protocol',
        },
        {
            text: gettext('Metric'),
            flex: 1,
            sortable: true,
            dataIndex: 'metric',
        },
    ],

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'IpVrfRoute',
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${me.nodename}/sdn/zones/${me.zone}/ip-vrf`,
                reader: {
                    type: 'json',
                    rootProperty: 'data',
                },
            },
            sorters: [
                {
                    property: 'ip',
                    direction: 'ASC',
                },
                {
                    property: 'nexthop',
                    direction: 'ASC',
                },
                {
                    property: 'metric',
                    direction: 'ASC',
                },
            ],
            autoLoad: true,
        });

        Ext.apply(me, {
            store,
        });

        me.callParent();
    },
});
