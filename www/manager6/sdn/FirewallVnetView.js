Ext.define('PVE.sdn.FirewallVnetView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNFirewallVnetView',

    stateful: true,
    stateId: 'grid-sdn-vnet-firewall',

    tabPanel: undefined,

    emptyText: gettext('No VNet configured.'),

    getRulesPanel: function () {
        let me = this;
        return me.tabPanel.items.getAt(0);
    },

    getOptionsPanel: function () {
        let me = this;
        return me.tabPanel.items.getAt(1);
    },

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'pve-sdn-vnet',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/vnets',
            },
            sorters: {
                property: ['zone', 'vnet'],
                direction: 'ASC',
            },
        });

        let reload = () => store.load();

        let sm = Ext.create('Ext.selection.RowModel', {});

        Ext.apply(me, {
            store: store,
            reloadStore: reload,
            selModel: sm,
            viewConfig: {
                trackOver: false,
            },
            columns: [
                {
                    header: 'ID',
                    flex: 1,
                    dataIndex: 'vnet',
                },
                {
                    header: gettext('Zone'),
                    flex: 1,
                    dataIndex: 'zone',
                    renderer: Ext.htmlEncode,
                },
                {
                    header: gettext('Alias'),
                    flex: 1,
                    dataIndex: 'alias',
                    renderer: Ext.htmlEncode,
                },
            ],
            listeners: {
                activate: reload,
                show: reload,
                select: function (_sm, rec) {
                    me.tabPanel.setDisabled(false);

                    me.getRulesPanel().setBaseUrl(`/cluster/sdn/vnets/${rec.id}/firewall/rules`);
                    me.getOptionsPanel().setBaseUrl(
                        `/cluster/sdn/vnets/${rec.id}/firewall/options`,
                    );
                },
            },
        });
        store.load();
        me.callParent();
    },
});
