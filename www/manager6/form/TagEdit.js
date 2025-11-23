Ext.define('PVE.panel.TagEditContainer', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveTagEditContainer',

    layout: {
        type: 'hbox',
        align: 'middle',
    },

    // set to false to hide the 'no tags' field and the edit button
    canEdit: true,
    editOnly: false,

    controller: {
        xclass: 'Ext.app.ViewController',

        loadTags: function (tagstring = '', force = false) {
            let me = this;
            let view = me.getView();

            if (me.oldTags === tagstring && !force) {
                return;
            }

            view.suspendLayout = true;
            me.forEachTag((tag) => {
                view.remove(tag);
            });
            me.getViewModel().set('tagCount', 0);
            let newtags = tagstring.split(/[;, ]/).filter((t) => !!t) || [];
            newtags.forEach((tag) => {
                me.addTag(tag);
            });
            view.suspendLayout = false;
            view.updateLayout();
            if (!force) {
                me.oldTags = tagstring;
            }
            me.tagsChanged();
        },

        onRender: function (v) {
            let me = this;
            let view = me.getView();
            view.toggleCls('hide-handles', PVE.UIOptions.shouldSortTags());

            view.dragzone = Ext.create('Ext.dd.DragZone', v.getEl(), {
                getDragData: function (e) {
                    let source = e.getTarget('.handle');
                    if (!source) {
                        return undefined;
                    }
                    let sourceId = source.parentNode.id;
                    let cmp = Ext.getCmp(sourceId);
                    let ddel = document.createElement('div');
                    ddel.classList.add('proxmox-tags-full');
                    ddel.innerHTML = Proxmox.Utils.getTagElement(
                        cmp.tag,
                        PVE.UIOptions.tagOverrides,
                    );
                    let repairXY = Ext.fly(source).getXY();
                    cmp.setDisabled(true);
                    ddel.id = Ext.id();
                    return {
                        ddel,
                        repairXY,
                        sourceId,
                    };
                },
                onMouseUp: function (target, e, id) {
                    let cmp = Ext.getCmp(this.dragData.sourceId);
                    if (cmp && !cmp.isDestroyed) {
                        cmp.setDisabled(false);
                    }
                },
                getRepairXY: function () {
                    return this.dragData.repairXY;
                },
                beforeInvalidDrop: function (target, e, id) {
                    let cmp = Ext.getCmp(this.dragData.sourceId);
                    if (cmp && !cmp.isDestroyed) {
                        cmp.setDisabled(false);
                    }
                },
            });
            view.dropzone = Ext.create('Ext.dd.DropZone', v.getEl(), {
                getTargetFromEvent: function (e) {
                    return e.getTarget('.proxmox-tag-dark,.proxmox-tag-light');
                },
                getIndicator: function () {
                    if (!view.indicator) {
                        view.indicator = Ext.create('Ext.Component', {
                            floating: true,
                            html: '<i class="fa fa-long-arrow-up"></i>',
                            hidden: true,
                            shadow: false,
                        });
                    }
                    return view.indicator;
                },
                onContainerOver: function () {
                    this.getIndicator().setVisible(false);
                },
                notifyOut: function () {
                    this.getIndicator().setVisible(false);
                },
                onNodeOver: function (target, dd, e, data) {
                    let indicator = this.getIndicator();
                    indicator.setVisible(true);
                    indicator.alignTo(Ext.getCmp(target.id), 't50-bl', [-1, -2]);
                    return this.dropAllowed;
                },
                onNodeDrop: function (target, dd, e, data) {
                    this.getIndicator().setVisible(false);
                    let sourceCmp = Ext.getCmp(data.sourceId);
                    if (!sourceCmp) {
                        return;
                    }
                    sourceCmp.setDisabled(false);
                    let targetCmp = Ext.getCmp(target.id);
                    view.remove(sourceCmp, { destroy: false });
                    view.insert(view.items.indexOf(targetCmp), sourceCmp);
                    me.tagsChanged();
                },
            });
        },

        forEachTag: function (func) {
            let me = this;
            let view = me.getView();
            view.items.each((field) => {
                if (field.getXType() === 'pveTag') {
                    func(field);
                }
                return true;
            });
        },

        toggleEdit: function (cancel) {
            let me = this;
            let vm = me.getViewModel();
            let view = me.getView();
            let editMode = !vm.get('editMode');
            vm.set('editMode', editMode);

            // get a current tag list for editing
            if (editMode) {
                PVE.UIOptions.update();
            }

            me.forEachTag((tag) => {
                tag.setMode(editMode ? 'editable' : 'normal');
            });

            if (!vm.get('editMode')) {
                let tags = [];
                if (cancel) {
                    me.loadTags(me.oldTags, true);
                } else {
                    let toRemove = [];
                    me.forEachTag((cmp) => {
                        if (cmp.isVisible() && cmp.tag) {
                            tags.push(cmp.tag);
                        } else {
                            toRemove.push(cmp);
                        }
                    });
                    toRemove.forEach((cmp) => view.remove(cmp));
                    tags = tags.join(',');
                    if (me.oldTags !== tags) {
                        me.oldTags = tags;
                        me.loadTags(tags, true);
                        me.getView().fireEvent('change', tags);
                    }
                }
            }
            me.getView().updateLayout();
        },

        tagsChanged: function () {
            let me = this;
            let tags = [];
            me.forEachTag((cmp) => {
                if (cmp.tag) {
                    tags.push(cmp.tag);
                }
            });
            me.getViewModel().set('isDirty', me.oldTags !== tags.join(','));
            me.forEachTag((cmp) => {
                cmp.updateFilter(tags);
            });
        },

        addTag: function (tag, isNew) {
            let me = this;
            let view = me.getView();
            let vm = me.getViewModel();
            let index = view.items.length - 5;
            if (PVE.UIOptions.shouldSortTags() && !isNew) {
                index = view.items.findIndexBy((tagField) => {
                    if (tagField.reference === 'noTagsField') {
                        return false;
                    }
                    if (tagField.xtype !== 'pveTag') {
                        return true;
                    }
                    let a = tagField.tag.toLowerCase();
                    let b = tag.toLowerCase();
                    return a > b ? true : a < b ? false : tagField.tag.localeCompare(tag) > 0;
                }, 1);
            }
            let tagField = view.insert(index, {
                xtype: 'pveTag',
                tag,
                mode: vm.get('editMode') ? 'editable' : 'normal',
                listeners: {
                    change: 'tagsChanged',
                    destroy: function () {
                        vm.set('tagCount', vm.get('tagCount') - 1);
                        me.tagsChanged();
                    },
                    keypress: function (key) {
                        if (vm.get('hideFinishButtons')) {
                            return;
                        }
                        if (key === 'Enter') {
                            me.editClick();
                        } else if (key === 'Escape') {
                            me.cancelClick();
                        }
                    },
                },
            });

            if (isNew) {
                me.tagsChanged();
                tagField.selectText();
            }

            vm.set('tagCount', vm.get('tagCount') + 1);
        },

        addTagClick: function (event) {
            let me = this;
            me.lookup('noTagsField').setVisible(false);
            me.addTag('', true);
        },

        cancelClick: function () {
            this.toggleEdit(true);
        },

        editClick: function () {
            this.toggleEdit(false);
        },

        init: function (view) {
            let me = this;
            if (view.tags) {
                me.loadTags(view.tags);
            }
            me.getViewModel().set('canEdit', view.canEdit);
            me.getViewModel().set('editOnly', view.editOnly);

            me.mon(Ext.GlobalEvents, 'loadedUiOptions', () => {
                let vm = me.getViewModel();
                view.toggleCls('hide-handles', PVE.UIOptions.shouldSortTags());
                me.loadTags(me.oldTags, !vm.get('editMode')); // refresh tag colors and order
            });

            if (view.editOnly) {
                me.toggleEdit();
            }
        },
    },

    getTags: function () {
        let me = this;
        let controller = me.getController();
        let tags = [];
        controller.forEachTag((cmp) => {
            if (cmp.tag.length) {
                tags.push(cmp.tag);
            }
        });

        return tags;
    },

    viewModel: {
        data: {
            tagCount: 0,
            editMode: false,
            canEdit: true,
            isDirty: false,
            editOnly: true,
        },

        formulas: {
            hideNoTags: function (get) {
                return get('tagCount') !== 0 || !get('canEdit');
            },
            hideEditBtn: function (get) {
                return get('editMode') || !get('canEdit');
            },
            hideFinishButtons: function (get) {
                return !get('editMode') || get('editOnly');
            },
        },
    },

    loadTags: function () {
        return this.getController().loadTags(...arguments);
    },

    items: [
        {
            xtype: 'box',
            reference: 'noTagsField',
            bind: {
                hidden: '{hideNoTags}',
            },
            html: gettext('No Tags'),
            style: {
                opacity: 0.5,
            },
        },
        {
            xtype: 'button',
            iconCls: 'fa fa-plus',
            tooltip: gettext('Add Tag'),
            bind: {
                hidden: '{!editMode}',
            },
            hidden: true,
            margin: '0 8 0 5',
            ui: 'default-toolbar',
            handler: 'addTagClick',
        },
        {
            xtype: 'tbseparator',
            ui: 'horizontal',
            bind: {
                hidden: '{hideFinishButtons}',
            },
            hidden: true,
        },
        {
            xtype: 'button',
            iconCls: 'fa fa-times',
            tooltip: gettext('Cancel Edit'),
            bind: {
                hidden: '{hideFinishButtons}',
            },
            hidden: true,
            margin: '0 5 0 0',
            ui: 'default-toolbar',
            handler: 'cancelClick',
        },
        {
            xtype: 'button',
            iconCls: 'fa fa-check',
            tooltip: gettext('Finish Edit'),
            bind: {
                hidden: '{hideFinishButtons}',
                disabled: '{!isDirty}',
            },
            hidden: true,
            handler: 'editClick',
        },
        {
            xtype: 'box',
            cls: 'pve-tag-inline-button',
            html: `<i data-qtip="${gettext('Edit Tags')}" class="fa fa-pencil"></i>`,
            bind: {
                hidden: '{hideEditBtn}',
            },
            listeners: {
                click: 'editClick',
                element: 'el',
            },
        },
    ],

    listeners: {
        render: 'onRender',
    },

    destroy: function () {
        let me = this;
        Ext.destroy(me.dragzone);
        Ext.destroy(me.dropzone);
        Ext.destroy(me.indicator);
        me.callParent();
    },
});
