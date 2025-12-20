Ext.define(
    'PVE.grid.TemplateSelector',
    {
        extend: 'Ext.grid.GridPanel',

        alias: 'widget.pveTemplateSelector',

        stateful: true,
        stateId: 'grid-template-selector',
        viewConfig: {
            trackOver: false,
        },
        initComponent: function () {
            var me = this;

            if (!me.nodename) {
                throw 'no node name specified';
            }

            var baseurl = '/nodes/' + me.nodename + '/aplinfo';
            var store = new Ext.data.Store({
                model: 'pve-aplinfo',
                groupField: 'section',
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json' + baseurl,
                },
            });

            var sm = Ext.create('Ext.selection.RowModel', {});

            var groupingFeature = Ext.create('Ext.grid.feature.Grouping', {
                groupHeaderTpl:
                    '{[ "Section: " + values.name ]} ({rows.length} Item{[values.rows.length > 1 ? "s" : ""]})',
            });

            var reload = function () {
                store.load();
            };

            Proxmox.Utils.monStoreErrors(me, store);

            Ext.apply(me, {
                store: store,
                selModel: sm,
                tbar: [
                    '->',
                    gettext('Search'),
                    {
                        xtype: 'textfield',
                        width: 200,
                        enableKeyEvents: true,
                        listeners: {
                            buffer: 500,
                            keyup: function (field) {
                                var value = field.getValue().toLowerCase();
                                store.clearFilter(true);
                                store.filterBy(function (rec) {
                                    return (
                                        rec.data.package.toLowerCase().indexOf(value) !== -1 ||
                                        rec.data.headline.toLowerCase().indexOf(value) !== -1
                                    );
                                });
                            },
                        },
                    },
                ],
                features: [groupingFeature],
                columns: [
                    {
                        header: gettext('Type'),
                        width: 80,
                        dataIndex: 'type',
                    },
                    {
                        header: gettext('Package'),
                        flex: 1,
                        dataIndex: 'package',
                    },
                    {
                        header: gettext('Version'),
                        width: 80,
                        dataIndex: 'version',
                    },
                    {
                        header: gettext('Description'),
                        flex: 1.5,
                        renderer: Ext.String.htmlEncode,
                        dataIndex: 'headline',
                    },
                ],
                listeners: {
                    afterRender: reload,
                },
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-aplinfo', {
            extend: 'Ext.data.Model',
            fields: [
                'template',
                'type',
                'package',
                'version',
                'headline',
                'infopage',
                'description',
                'os',
                'section',
            ],
            idProperty: 'template',
        });
    },
);

Ext.define('PVE.storage.TemplateDownload', {
    extend: 'Ext.window.Window',
    alias: 'widget.pveTemplateDownload',

    modal: true,
    title: gettext('Templates'),
    layout: 'fit',
    width: 900,
    height: 600,
    initComponent: function () {
        var me = this;

        var grid = Ext.create('PVE.grid.TemplateSelector', {
            border: false,
            scrollable: true,
            nodename: me.nodename,
        });

        var sm = grid.getSelectionModel();

        var submitBtn = Ext.create('Proxmox.button.Button', {
            text: gettext('Download'),
            disabled: true,
            selModel: sm,
            handler: function (button, event, rec) {
                Proxmox.Utils.API2Request({
                    url: '/nodes/' + me.nodename + '/aplinfo',
                    params: {
                        storage: me.storage,
                        template: rec.data.template,
                    },
                    method: 'POST',
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                    success: function (response, options) {
                        var upid = response.result.data;

                        Ext.create('Proxmox.window.TaskViewer', {
                            upid: upid,
                            listeners: {
                                destroy: me.reloadGrid,
                            },
                        }).show();

                        me.close();
                    },
                });
            },
        });

        Ext.apply(me, {
            items: grid,
            buttons: [submitBtn],
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.OciRegistryPull', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveOciRegistryPull',
    mixins: ['Proxmox.Mixin.CBind'],

    method: 'POST',

    showTaskViewer: true,

    title: gettext('Pull from OCI Registry'),
    submitText: gettext('Download'),
    width: 450,

    cbind: {
        url: '/nodes/{nodename}/storage/{storage}/oci-registry-pull',
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        onReferenceChange: function (field, value) {
            let me = this;
            let view = me.getView();
            let tagField = view.down('[name=tag]');
            tagField.setComboItems([]);
            let matches = me.parseReference(value);
            if (matches) {
                let ref = matches[0];
                let tag = matches[1];

                if (tag) {
                    field.setValue(ref);
                    tagField.setValue(tag);
                    tagField.focus();
                } else {
                    tagField.clearValue();
                }
            }
        },

        parseReference: function (value) {
            const re = new RegExp(
                '^((?:[a-zA-Z\\d](?:[a-zA-Z\\d-]*[a-zA-Z\\d])?(?:\\.(?:[a-zA-Z\\d]' +
                    '(?:[a-zA-Z\\d-]*[a-zA-Z\\d])?))*(?::\\d+)?/)?[a-z\\d]+(?:(?:[._]|__|-+)' +
                    '[a-z\\d]+)*(?:/[a-z\\d]+(?:(?:[._]|__|-+)[a-z\\d]+)*)*)' +
                    '(?::(\\w[\\w.-]{0,127}))?$',
            );
            let matches = value.match(re);
            if (matches) {
                let ref = matches[1];
                let tag = matches[2];
                return [ref, tag];
            }
            return undefined;
        },

        queryTags: function (field) {
            let me = this;
            let view = me.getView();
            let refField = view.down('[name=reference]');
            let reference = refField.value.trim();
            let tagField = view.down('[name=tag]');

            Proxmox.Utils.API2Request({
                url: `/nodes/${view.nodename}/query-oci-repo-tags`,
                method: 'GET',
                params: {
                    reference,
                },
                waitMsgTarget: view,
                failure: (res) => {
                    Ext.MessageBox.alert(gettext('Error'), res.htmlStatus);
                },
                success: function (res, opt) {
                    let tags = res.result.data;
                    tagField.clearValue();
                    tagField.setComboItems(tags.map((tag) => [tag, Ext.htmlEncode(tag)]));
                },
            });
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            border: false,
            onGetValues: function (values) {
                values.reference = values.reference + ':' + values.tag;
                delete values.tag;
                if (!values.filename) {
                    delete values.filename;
                }
                return values;
            },
            items: [
                {
                    xtype: 'fieldcontainer',
                    layout: 'hbox',
                    fieldLabel: gettext('Reference'),
                    items: [
                        {
                            xtype: 'textfield',
                            name: 'reference',
                            allowBlank: false,
                            emptyText: 'registry.example.org/name',
                            flex: 1,
                            listeners: {
                                change: 'onReferenceChange',
                            },
                            validator: function (value) {
                                let me = this;
                                let controller = me.up('pveOciRegistryPull').getController();
                                if (controller.parseReference(value)) {
                                    return true;
                                }
                                return gettext('Invalid OCI Registry Reference');
                            },
                        },
                        {
                            xtype: 'button',
                            name: 'check',
                            text: gettext('Query Tags'),
                            margin: '0 0 0 5',
                            listeners: {
                                click: 'queryTags',
                            },
                        },
                    ],
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    name: 'tag',
                    allowBlank: false,
                    // TRANSLATORS: As in a version of an OCI container, e.g. debian:latest
                    emptyText: gettext("for example 'latest'"),
                    fieldLabel: gettext('Tag'),
                    forceSelection: false,
                    editable: true,
                    typeAhead: true,
                    comboItems: [],
                },
                {
                    xtype: 'textfield',
                    name: 'filename',
                    emptyText: '<reference>_<tag>',
                    fieldLabel: gettext('File name'),
                },
            ],
        },
    ],

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.callParent();
    },
});

Ext.define('PVE.storage.TemplateView', {
    extend: 'PVE.storage.ContentView',

    alias: 'widget.pveStorageTemplateView',

    initComponent: function () {
        var me = this;

        var nodename = (me.nodename = me.pveSelNode.data.node);
        if (!nodename) {
            throw 'no node name specified';
        }

        var storage = (me.storage = me.pveSelNode.data.storage);
        if (!storage) {
            throw 'no storage ID specified';
        }

        me.content = 'vztmpl';

        var reload = function () {
            me.store.load();
        };

        var templateButton = Ext.create('Proxmox.button.Button', {
            itemId: 'tmpl-btn',
            text: gettext('Templates'),
            handler: function () {
                var win = Ext.create('PVE.storage.TemplateDownload', {
                    nodename: nodename,
                    storage: storage,
                    reloadGrid: reload,
                });
                win.show();
            },
        });

        var pullOciImageButton = Ext.create('Proxmox.button.Button', {
            itemId: 'pull-oci-img-btn',
            text: gettext('Pull from OCI Registry'),
            handler: function () {
                var win = Ext.create('PVE.storage.OciRegistryPull', {
                    nodename: nodename,
                    storage: storage,
                    taskDone: () => reload(),
                });
                win.show();
            },
        });

        me.tbar = [templateButton, pullOciImageButton];
        me.useUploadButton = true;

        me.callParent();
    },
});
