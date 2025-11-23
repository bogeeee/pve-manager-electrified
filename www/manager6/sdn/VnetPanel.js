Ext.define('PVE.sdn.Vnet', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNVnet',

    title: 'VNet',

    onlineHelp: 'pvesdn_config_vnet',

    initComponent: function () {
        var me = this;

        var subnetview_panel = Ext.createWidget('pveSDNSubnetView', {
            title: gettext('Subnets'),
            region: 'center',
            border: false,
        });

        var vnetview_panel = Ext.createWidget('pveSDNVnetView', {
            title: 'VNets',
            region: 'west',
            subnetview_panel: subnetview_panel,
            width: '50%',
            border: false,
            split: true,
        });

        Ext.apply(me, {
            layout: 'border',
            items: [vnetview_panel, subnetview_panel],
            listeners: {
                show: function () {
                    subnetview_panel.fireEvent('show', subnetview_panel);
                },
            },
        });

        me.callParent();
    },
});
