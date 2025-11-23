Ext.define('PVE.sdn.EvpnZoneMacVrfPanel', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNEvpnZoneMacVrfPanel',

    title: 'MAC-VRFs',
    onlineHelp: 'pvesdn_zone_plugin_evpn',

    initComponent: function () {
        var me = this;
        let nodename = me.nodename;

        var mac_vrf_panel = Ext.createWidget('pveSDNEvpnZoneMacVrfGridPanel', {
            title: gettext('VNet MAC-VRF'),
            region: 'center',
            border: false,
        });

        var vnetview_panel = Ext.createWidget('pveSDNZoneContentView', {
            title: gettext('VNets'),
            region: 'west',
            sub_panel: mac_vrf_panel,
            nodename: me.nodename,
            zone: me.zone,

            width: '50%',
            border: false,
            split: true,

            on_select: function (_sm, rec) {
                mac_vrf_panel.setVnet(rec.data.vnet, nodename);
            },

            on_deselect: function () {
                mac_vrf_panel.clearVnet();
            },
        });

        Ext.apply(me, {
            layout: 'border',
            items: [vnetview_panel, mac_vrf_panel],
        });

        me.callParent();
    },
});

Ext.define('MacVrfRoute', {
    extend: 'Ext.data.Model',
    fields: ['ip', 'metric', 'nexthops', 'protocol'],
});

Ext.define('PVE.sdn.EvpnZoneMacVrfGridPanel', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNEvpnZoneMacVrfGridPanel',

    title: gettext('MAC-VRF'),

    stateful: true,
    stateId: 'grid-sdn-mac-vrf',

    columns: [
        {
            text: gettext('IP'),
            flex: 1,
            sortable: true,
            dataIndex: 'ip',
        },
        {
            text: gettext('MAC-Address'),
            flex: 1,
            sortable: true,
            dataIndex: 'mac',
        },
        {
            text: gettext('Nexthop'),
            flex: 1,
            dataIndex: 'nexthop',
        },
    ],

    clearVnet: function () {
        let me = this;

        me.getStore().removeAll();
    },

    setVnet: function (vnet, node) {
        let me = this;

        let store = me.getStore();

        store.getProxy().setUrl(`/api2/json/nodes/${node}/sdn/vnets/${vnet}/mac-vrf`);
        store.load();
    },

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'MacVrfRoute',
            proxy: {
                type: 'proxmox',
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
                    property: 'mac',
                    direction: 'ASC',
                },
                {
                    property: 'nexthop',
                    direction: 'ASC',
                },
            ],
        });

        Ext.apply(me, {
            store,
        });

        me.callParent();
    },
});
