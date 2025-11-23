Ext.define('PVE.sdn.FirewallPanel', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSDNFirewall',

    title: 'VNet',

    onlineHelp: 'pvesdn_firewall_integration',

    initComponent: function () {
        let me = this;

        let tabPanel = Ext.create('Ext.TabPanel', {
            fullscreen: true,
            region: 'center',
            border: false,
            split: true,
            disabled: true,
            flex: 2,
            items: [
                {
                    xtype: 'pveFirewallRules',
                    title: gettext('Rules'),
                    list_refs_url: '/cluster/firewall/refs',
                    firewall_type: 'vnet',
                },
                {
                    xtype: 'pveFirewallOptions',
                    title: gettext('Options'),
                    fwtype: 'vnet',
                },
            ],
        });

        let vnetPanel = Ext.createWidget('pveSDNFirewallVnetView', {
            title: 'VNets',
            region: 'west',
            border: false,
            split: true,
            forceFit: true,
            flex: 1,
            tabPanel,
        });

        Ext.apply(me, {
            layout: 'border',
            items: [vnetPanel, tabPanel],
        });

        me.callParent();
    },
});
