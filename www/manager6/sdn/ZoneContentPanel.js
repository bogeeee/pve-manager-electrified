Ext.define('PVE.sdn.ZoneContentPanel', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNZoneContentPanel',

    title: 'VNet',

    onlineHelp: 'pvesdn_config_vnet',

    initComponent: function () {
        var me = this;

        var permissions_panel = Ext.createWidget('pveSDNVnetACLView', {
            title: gettext('VNet Permissions'),
            region: 'center',
            border: false,
        });

        var vnetview_panel = Ext.createWidget('pveSDNZoneContentView', {
            title: 'VNets',
            region: 'west',
            sub_panel: permissions_panel,
            nodename: me.nodename,
            zone: me.zone,
            width: '50%',
            border: false,
            split: true,

            on_select: function (_sm, rec) {
                let path = `/sdn/zones/${me.zone}/${rec.data.vnet}`;
                permissions_panel.setPath(path);
            },

            on_deselect: function () {
                permissions_panel.setPath(undefined);
            },
        });

        Ext.apply(me, {
            layout: 'border',
            items: [vnetview_panel, permissions_panel],
            listeners: {
                show: function () {
                    permissions_panel.fireEvent('show', permissions_panel);
                },
            },
        });

        me.callParent();
    },
});
