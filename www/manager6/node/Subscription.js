Ext.define('PVE.node.SubscriptionKeyEdit', {
    extend: 'Proxmox.window.Edit',

    title: gettext('Upload Subscription Key'),
    width: 350,

    items: {
        xtype: 'textfield',
        name: 'key',
        value: '',
        fieldLabel: gettext('Subscription Key'),
        labelWidth: 120,
        getSubmitValue: function () {
            return this.processRawValue(this.getRawValue())?.trim();
        },
    },

    initComponent: function () {
        var me = this;

        me.callParent();

        me.load();
    },
});

Ext.define('PVE.node.Subscription', {
    extend: 'Proxmox.grid.ObjectGrid',

    alias: ['widget.pveNodeSubscription'],

    onlineHelp: 'getting_help',

    viewConfig: {
        enableTextSelection: true,
    },

    showReport: function () {
        var me = this;

        var getReportFileName = function () {
            var now = Ext.Date.format(new Date(), 'D-d-F-Y-G-i');
            return `${me.nodename}-pve-report-${now}.txt`;
        };

        var view = Ext.createWidget('component', {
            itemId: 'system-report-view',
            scrollable: true,
            style: {
                'white-space': 'pre',
                'font-family': 'monospace',
                padding: '5px',
            },
        });

        var reportWindow = Ext.create('Ext.window.Window', {
            title: gettext('System Report'),
            width: 1024,
            height: 600,
            layout: 'fit',
            modal: true,
            buttons: [
                '->',
                {
                    text: gettext('Download'),
                    handler: function () {
                        var fileContent = Ext.String.htmlDecode(
                            reportWindow.getComponent('system-report-view').html,
                        );
                        var fileName = getReportFileName();

                        // Internet Explorer
                        if (window.navigator.msSaveOrOpenBlob) {
                            navigator.msSaveOrOpenBlob(new Blob([fileContent]), fileName);
                        } else {
                            let element = document.createElement('a');
                            element.setAttribute(
                                'href',
                                'data:text/plain;charset=utf-8,' + encodeURIComponent(fileContent),
                            );
                            element.setAttribute('download', fileName);
                            element.style.display = 'none';
                            document.body.appendChild(element);
                            element.click();
                            document.body.removeChild(element);
                        }
                    },
                },
            ],
            items: view,
        });

        Proxmox.Utils.API2Request({
            url: '/api2/extjs/nodes/' + me.nodename + '/report',
            method: 'GET',
            waitMsgTarget: me,
            failure: function (response) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function (response) {
                var report = Ext.htmlEncode(response.result.data);
                reportWindow.show();
                view.update(report);
            },
        });
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        let rows = {
            productname: {
                header: gettext('Type'),
            },
            key: {
                header: gettext('Subscription Key'),
            },
            status: {
                header: gettext('Status'),
                renderer: (v) => {
                    let message = me.getObjectValue('message');
                    return message ? `${v}: ${message}` : v;
                },
            },
            message: {
                visible: false,
            },
            serverid: {
                header: gettext('Server ID'),
            },
            sockets: {
                header: gettext('Sockets'),
            },
            checktime: {
                header: gettext('Last checked'),
                renderer: Proxmox.Utils.render_timestamp,
            },
            nextduedate: {
                header: gettext('Next due date'),
            },
            signature: {
                header: gettext('Signed/Offline'),
                renderer: (v) => (v ? gettext('Yes') : gettext('No')),
            },
        };

        Ext.apply(me, {
            url: `/api2/json/nodes/${me.nodename}/subscription`,
            cwidth1: 170,
            tbar: [
                {
                    text: gettext('Upload Subscription Key'),
                    handler: () =>
                        Ext.create('PVE.node.SubscriptionKeyEdit', {
                            autoShow: true,
                            url: `/api2/extjs/nodes/${me.nodename}/subscription`,
                            listeners: {
                                destroy: () => me.rstore.load(),
                            },
                        }),
                },
                {
                    text: gettext('Check'),
                    handler: () =>
                        Proxmox.Utils.API2Request({
                            params: { force: 1 },
                            url: `/nodes/${me.nodename}/subscription`,
                            method: 'POST',
                            waitMsgTarget: me,
                            failure: (response) =>
                                Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                            callback: () => me.rstore.load(),
                        }),
                },
                {
                    text: gettext('Remove Subscription'),
                    xtype: 'proxmoxStdRemoveButton',
                    confirmMsg: gettext('Are you sure you want to remove the subscription key?'),
                    baseurl: `/nodes/${me.nodename}/subscription`,
                    dangerous: true,
                    selModel: false,
                    callback: () => me.rstore.load(),
                },
                '-',
                {
                    text: gettext('System Report'),
                    handler: function () {
                        Proxmox.Utils.checked_command(function () {
                            me.showReport();
                        });
                    },
                },
            ],
            rows: rows,
            listeners: {
                activate: () => me.rstore.load(),
            },
        });

        me.callParent();
    },
});
