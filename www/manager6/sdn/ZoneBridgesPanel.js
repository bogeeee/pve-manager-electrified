Ext.define('PVE.sdn.ZoneBridgePanel', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNZoneBridgePanel',

    title: gettext('Bridges'),
    onlineHelp: 'pvesdn_zone_plugin_evpn',

    stateful: true,
    stateId: 'grid-sdn-zone-bridges',

    initComponent: function () {
        var me = this;
        let nodename = me.nodename;

        var bridge_ports_panel = Ext.createWidget('pveSDNZoneBridgePortsPanel', {
            title: gettext('Bridge Ports'),
            region: 'center',
            border: false,
        });

        var vnetview_panel = Ext.createWidget('pveSDNZoneBridgeView', {
            title: gettext('VNets'),
            region: 'west',
            nodename: me.nodename,
            zone: me.zone,

            width: '50%',
            border: false,
            split: true,

            on_select: function (_sm, rec) {
                let deepCopy = structuredClone(rec.data.ports);
                bridge_ports_panel.setPorts(deepCopy, nodename);
            },

            on_deselect: function () {
                bridge_ports_panel.clearPorts();
            },
        });

        Ext.apply(me, {
            layout: 'border',
            items: [vnetview_panel, bridge_ports_panel],
        });

        me.callParent();
    },
});

Ext.define('ZoneBridgePort', {
    extend: 'Ext.data.Model',
    fields: ['index', 'name', 'primary_vlan', 'vlans', 'vmid'],
});

Ext.define('PVE.sdn.ZoneBridgePortsPanel', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNZoneBridgePortsPanel',

    title: gettext('IP-VRF'),
    onlineHelp: 'pvesdn_zone_plugin_evpn',

    stateful: true,
    stateId: 'grid-sdn-zone-ports',

    columns: [
        {
            text: gettext('Name'),
            flex: 2,
            sortable: true,
            dataIndex: 'name',
        },
        {
            text: gettext('VMID'),
            flex: 1,
            sortable: true,
            dataIndex: 'vmid',
        },
        {
            text: gettext('Guest Network Device'),
            flex: 1,
            sortable: true,
            dataIndex: 'index',
        },
        {
            text: gettext('Primary VLAN'),
            flex: 1,
            sortable: true,
            dataIndex: 'primary_vlan',
        },
        {
            text: gettext('VLANs'),
            flex: 1,
            sortable: true,
            dataIndex: 'vlans',
        },
    ],

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'ZoneBridge',
            sorters: [
                {
                    property: 'vmid',
                    direction: 'ASC',
                },
                {
                    property: 'index',
                    direction: 'ASC',
                },
            ],
        });

        Ext.apply(me, {
            store,
        });

        me.callParent();
    },

    setPorts: function (ports) {
        let me = this;
        me.getStore().setData(ports);
    },

    clearPorts: function (ports) {
        let me = this;
        me.getStore().removeAll();
    },
});
