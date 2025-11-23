Ext.define('PVE.sdn.VnetView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNVnetView',

    onlineHelp: 'pvesdn_config_vnet',
    emptyText: gettext('No VNet configured.'),

    stateful: true,
    stateId: 'grid-sdn-vnet',

    subnetview_panel: undefined,

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'pve-sdn-vnet',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/vnets?pending=1',
            },
            sorters: {
                property: 'vnet',
                direction: 'ASC',
            },
        });

        let reload = () => store.load();

        let sm = Ext.create('Ext.selection.RowModel', {});

        let run_editor = function () {
            let rec = sm.getSelection()[0];

            let win = Ext.create('PVE.sdn.VnetEdit', {
                autoShow: true,
                onlineHelp: 'pvesdn_config_vnet',
                vnet: rec.data.vnet,
            });
            win.on('destroy', reload);
        };

        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });

        let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/cluster/sdn/vnets/',
            callback: reload,
        });

        let set_button_status = function () {
            var rec = me.selModel.getSelection()[0];

            if (!rec || rec.data.state === 'deleted') {
                edit_btn.disable();
                remove_btn.disable();
            }
        };

        Ext.apply(me, {
            store: store,
            reloadStore: reload,
            selModel: sm,
            viewConfig: {
                trackOver: false,
            },
            tbar: [
                {
                    text: gettext('Create'),
                    handler: function () {
                        let win = Ext.create('PVE.sdn.VnetEdit', {
                            autoShow: true,
                            onlineHelp: 'pvesdn_config_vnet',
                            type: 'vnet',
                        });
                        win.on('destroy', reload);
                    },
                },
                remove_btn,
                edit_btn,
            ],
            columns: [
                {
                    header: 'ID',
                    flex: 2,
                    dataIndex: 'vnet',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'vnet', 1);
                    },
                },
                {
                    header: gettext('Alias'),
                    flex: 1,
                    dataIndex: 'alias',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'alias');
                    },
                },
                {
                    header: gettext('Zone'),
                    flex: 1,
                    dataIndex: 'zone',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'zone');
                    },
                },
                {
                    header: gettext('Tag'),
                    flex: 1,
                    dataIndex: 'tag',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'tag');
                    },
                },
                {
                    header: gettext('VLAN Aware'),
                    flex: 1,
                    dataIndex: 'vlanaware',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'vlanaware');
                    },
                },
                {
                    header: gettext('State'),
                    width: 100,
                    dataIndex: 'state',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending_state(rec, value);
                    },
                },
            ],
            listeners: {
                activate: reload,
                itemdblclick: run_editor,
                selectionchange: set_button_status,
                show: reload,
                select: function (_sm, rec) {
                    let url = `/cluster/sdn/vnets/${rec.data.vnet}/subnets`;
                    me.subnetview_panel.setBaseUrl(url);
                },
                deselect: function () {
                    me.subnetview_panel.setBaseUrl(undefined);
                },
            },
        });
        store.load();
        me.callParent();
    },
});
