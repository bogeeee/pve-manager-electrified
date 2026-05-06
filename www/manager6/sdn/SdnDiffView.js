Ext.define('PVE.sdn.SdnDiffView', {
    extend: 'Ext.window.Window',

    width: 800,
    height: 900,

    modal: true,
    title: gettext('Pending SDN configuration changes'),

    layout: {
        type: 'vbox',
        align: 'stretch',
    },

    viewModel: {
        data: {
            node: undefined,
            frr_diff: '',
            interfaces_diff: '',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        nodeChange: function (_field, value) {
            let me = this;
            let vm = me.getViewModel();
            let view = me.getView();

            vm.set('node', value);
            view.setLoading(gettext('Fetching diff...'));

            Proxmox.Async.api2({
                url: '/cluster/sdn/dry-run',
                params: { node: value },
                method: 'GET',
            })
                .then((req) => {
                    let diff = req.result.data;

                    vm.set('frr_diff', Ext.htmlEncode(diff['frr-diff'] ?? gettext('No changes')));
                    vm.set(
                        'interfaces_diff',
                        Ext.htmlEncode(diff['interfaces-diff'] ?? gettext('No changes')),
                    );
                })
                .catch(Proxmox.Utils.alertResponseFailure)
                .finally(() => {
                    view.setLoading(false);
                });
        },
    },

    items: [
        {
            xtype: 'pveNodeSelector',
            fieldLabel: gettext('Node'),
            padding: 10,
            labelWidth: 120,
            name: 'node',
            allowBlank: false,
            listeners: {
                change: 'nodeChange',
            },
        },
        {
            xtype: 'panel',
            title: gettext('FRR Config'),
            flex: 1,
            scrollable: true,
            items: [
                {
                    xtype: 'component',
                    padding: 5,
                    style: {
                        'white-space': 'pre',
                        'font-family': 'monospace',
                    },
                    bind: {
                        html: '{frr_diff}',
                    },
                },
            ],
        },
        {
            xtype: 'panel',
            title: gettext('Interfaces Config'),
            flex: 1,
            scrollable: true,
            items: [
                {
                    xtype: 'component',
                    padding: 5,
                    style: {
                        'white-space': 'pre',
                        'font-family': 'monospace',
                    },
                    bind: {
                        html: '{interfaces_diff}',
                    },
                },
            ],
        },
    ],
    buttons: [
        {
            text: gettext('Close'),
            handler: function () {
                this.up('window').close();
            },
        },
    ],
});
